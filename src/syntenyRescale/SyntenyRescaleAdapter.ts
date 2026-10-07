import { BaseFeatureDataAdapter } from '@jbrowse/core/data_adapters/BaseAdapter'
import { ObservableCreate } from '@jbrowse/core/util/rxjs'

import { rescaleToWindow, spanPlacers } from './rescaleToWindow'
import { encodeSyntenyFeatureId } from './syntenyFeatureId'

import type { Placeable, Placement, SyntenyGene } from './rescaleToWindow'
import type { BaseOptions } from '@jbrowse/core/data_adapters/BaseAdapter'
import type { Feature } from '@jbrowse/core/util/simpleFeature'
import type { Region } from '@jbrowse/core/util/types'
import type { Observable } from 'rxjs'

/**
 * A feature drawn somewhere other than where its source put it. Delegates every
 * read, overriding only position and id.
 */
class PlacedFeature implements Feature {
  constructor(
    private inner: Feature,
    private placedStart: number,
    private placedEnd: number,
    private placedId: string,
    /**
     * Already-placed children. A gene that moves while its exons stay put draws
     * a glyph from two coordinate systems at once, so the tree is rebuilt whole
     * or not at all.
     */
    private placedChildren?: Feature[],
  ) {}

  // the overload set is Feature's, restated so callers keep the narrow return
  // types — the same reason Gff3Feature restates them
  get(name: 'refName'): string
  get(name: 'name' | 'type' | 'id' | 'source'): string | undefined
  get(name: 'start' | 'end'): number
  get(name: 'phase'): 0 | 1 | 2 | undefined
  get(name: 'strand'): -1 | 0 | 1 | undefined
  get(name: 'score'): number | undefined
  get(name: 'subfeatures'): Feature[] | undefined
  get(name: string): unknown
  get(name: string): unknown {
    return name === 'start'
      ? this.placedStart
      : name === 'end'
        ? this.placedEnd
        : name === 'uniqueId'
          ? this.placedId
          : // provenance, and the one thing that answers "is the rescale even
            // running" without a debugger: the details panel shows it
            name === 'rescaledFrom'
            ? `${this.inner.get('start')}-${this.inner.get('end')}`
            : name === 'subfeatures'
              ? (this.placedChildren ?? this.inner.get('subfeatures'))
              : this.inner.get(name)
  }

  id() {
    return this.placedId
  }

  parent() {
    return this.inner.parent?.()
  }

  children() {
    return this.placedChildren ?? this.inner.children?.()
  }

  toJSON() {
    return {
      ...this.inner.toJSON(),
      start: this.placedStart,
      end: this.placedEnd,
      uniqueId: this.placedId,
      rescaledFrom: `${this.inner.get('start')}-${this.inner.get('end')}`,
      ...(this.placedChildren
        ? { subfeatures: this.placedChildren.map(c => c.toJSON()) }
        : {}),
    }
  }
}

/**
 * Repositions syntenic features against the window being drawn.
 *
 * The GFF stores each gene's liftover onto the reference, which is exact per
 * gene and lossy between them: paralogs stack on one reference gene and
 * insertions compress to nothing. This adapter recomputes positions from the
 * genes' own coordinates across the window, which restores both — the JBrowse 1
 * feature API's behaviour, moved from the service into the client.
 *
 * It is viewport-dependent by nature, so the display has to ask for it again
 * when the viewport moves; see `installSyntenyRefetch`.
 */
export default class SyntenyRescaleAdapter extends BaseFeatureDataAdapter {
  private subAdapterP?: Promise<BaseFeatureDataAdapter>

  private async getSub(): Promise<BaseFeatureDataAdapter> {
    this.subAdapterP ??= (async () => {
      const subconf = this.getConf('subadapter') as Record<string, unknown>
      const sub = await this.getSubAdapter?.(subconf as never)
      if (!sub) {
        throw new Error('SyntenyRescaleAdapter: no subadapter configured')
      }
      return sub.dataAdapter as BaseFeatureDataAdapter
    })()
    return this.subAdapterP
  }

  async getRefNames(opts?: BaseOptions) {
    return (await this.getSub()).getRefNames(opts)
  }

  private attr(name: string) {
    return this.getConf(name) as string
  }

  /**
   * GFF3 attribute names reach a feature lowercased, so `nativeStart` in the
   * config has to find `nativestart` on the feature. Tries the spelling as
   * configured first, since another adapter may preserve case.
   */
  private read(feature: Feature, slot: string): unknown {
    const name = this.attr(slot)
    return feature.get(name) ?? feature.get(name.toLowerCase())
  }

  /**
   * Reads the fields the rescale needs off a feature, or undefined when the
   * feature is not one it repositions — a span bar, or a gene whose native
   * coordinates are missing because the pipeline did not write them.
   */
  private geneOf(feature: Feature): SyntenyGene | undefined {
    const types = this.getConf('rescaleTypes') as string[]
    if (!types.includes(String(feature.get('type')))) {
      return undefined
    }
    const nativeStart = Number(this.read(feature, 'nativeStartAttribute'))
    const nativeEnd = Number(this.read(feature, 'nativeEndAttribute'))
    const syntenyId = this.read(feature, 'spanAttribute')
    if (
      !Number.isFinite(nativeStart) ||
      !Number.isFinite(nativeEnd) ||
      !syntenyId
    ) {
      return undefined
    }
    return {
      id: feature.id(),
      syntenyId: String(syntenyId),
      start: feature.get('start'),
      end: feature.get('end'),
      nativeStart,
      nativeEnd,
      spanIsReversed: String(this.read(feature, 'reversedAttribute')) === '1',
    }
  }

  /**
   * A gene's parts, moved by the gene's own transform, recursively — a
   * transcript and the CDS and UTRs under it.
   *
   * Undefined when the feature has no children, so an unchanged feature is
   * passed through rather than wrapped. A child with no native coordinates of
   * its own keeps its stored position: wrong, but visibly wrong next to a
   * parent that moved, which is better than inventing a coordinate for it.
   */
  private placeChildren(
    feature: Feature,
    placer: ((at: Placeable) => Placement) | undefined,
  ): Feature[] | undefined {
    const children = feature.get('subfeatures')
    if (!children?.length || !placer) {
      return undefined
    }
    const reversed = String(this.read(feature, 'reversedAttribute')) === '1'
    return children.map(child => {
      const nativeStart = Number(this.read(child, 'nativeStartAttribute'))
      const nativeEnd = Number(this.read(child, 'nativeEndAttribute'))
      const at =
        Number.isFinite(nativeStart) && Number.isFinite(nativeEnd)
          ? placer({ nativeStart, nativeEnd, spanIsReversed: reversed })
          : undefined
      const grandchildren = this.placeChildren(child, placer)
      return at === undefined && grandchildren === undefined
        ? child
        : new PlacedFeature(
            child,
            at?.start ?? child.get('start'),
            at?.end ?? child.get('end'),
            child.id(),
            grandchildren,
          )
    })
  }

  /**
   * Collects the whole window before emitting any of it. The rescale is a
   * property of the set — a gene's position depends on the other genes in its
   * span — so there is nothing to stream.
   */
  getFeatures(region: Region, opts?: BaseOptions): Observable<Feature> {
    return ObservableCreate<Feature>(async observer => {
      const sub = await this.getSub()
      const features = await sub.getFeaturesArray(region, opts)

      const genes: SyntenyGene[] = []
      for (const feature of features) {
        const gene = this.geneOf(feature)
        if (gene) {
          genes.push(gene)
        }
      }
      const placed = rescaleToWindow(genes)
      const placers = spanPlacers(genes)

      for (const feature of features) {
        const at = placed.get(feature.id())
        const group = this.read(feature, 'orthologGroupAttribute')
        const id = encodeSyntenyFeatureId(
          feature.id(),
          group ? String(group) : undefined,
        )
        const gene = this.geneOf(feature)
        const children = gene
          ? this.placeChildren(feature, placers.get(gene.syntenyId))
          : undefined
        const changed =
          at !== undefined || id !== feature.id() || children !== undefined
        observer.next(
          changed
            ? new PlacedFeature(
                feature,
                at?.start ?? feature.get('start'),
                at?.end ?? feature.get('end'),
                id,
                children,
              )
            : feature,
        )
      }
      observer.complete()
    }, opts?.signal)
  }

  freeResources() {}
}
