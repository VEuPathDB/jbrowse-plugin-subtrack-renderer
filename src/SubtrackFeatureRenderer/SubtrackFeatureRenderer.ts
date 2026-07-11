import { BoxRendererType } from '@jbrowse/core/pluggableElementTypes'
import { readConfObject } from '@jbrowse/core/configuration'
import { MultiLayout } from '@jbrowse/core/util/layouts'
import GranularRectLayout from '@jbrowse/core/util/layouts/GranularRectLayout'
import deepEqual from 'fast-deep-equal'

import { doAll } from './doAll'
import { buildLayoutKey } from './subtrackUtils'

import type { RenderArgsDeserialized } from '@jbrowse/core/pluggableElementTypes/renderers/BoxRendererType'
import type { Subtrack } from './subtrackUtils'
import type { SerializedLayout } from '@jbrowse/core/util/layouts/BaseLayout'
import type { AnyConfigurationModel } from '@jbrowse/core/configuration'
import type { Region } from '@jbrowse/core/util'

/**
 * Layout session props for subtrack renderer
 */
interface LayoutSessionProps {
  regions: Region[]
  config: AnyConfigurationModel
  bpPerPx: number
}

/**
 * Cached layout with props for validation
 */
interface CachedLayout {
  layout: MultiLayout<GranularRectLayout<unknown>, unknown>
  props: LayoutSessionProps
}

/**
 * Custom layout session for subtrack renderer
 * Manages a persistent MultiLayout that gets recreated when config changes
 */
class SubtrackLayoutSession {
  props: LayoutSessionProps
  cachedLayout: CachedLayout | undefined

  constructor(props: LayoutSessionProps) {
    this.props = props
  }

  update(props: LayoutSessionProps) {
    this.props = props
    return this
  }

  /**
   * Create a new MultiLayout with config values applied
   */
  makeLayout(): MultiLayout<GranularRectLayout<unknown>, unknown> {
    return new MultiLayout(GranularRectLayout, {
      maxHeight: readConfObject(this.props.config, 'maxHeight'),
      displayMode: readConfObject(this.props.config, 'displayMode'),
      pitchX: this.props.bpPerPx,
      pitchY: readConfObject(this.props.config, 'noSpacing') ? 1 : 3,
    })
  }

  /**
   * Check if cached layout is still valid for current props
   * Uses deep equality check on config to detect any changes
   */
  cachedLayoutIsValid(cachedLayout: CachedLayout): boolean {
    return (
      cachedLayout.props.bpPerPx === this.props.bpPerPx &&
      deepEqual(
        readConfObject(this.props.config),
        readConfObject(cachedLayout.props.config),
      )
    )
  }

  /**
   * Get layout, recreating if config or zoom has changed
   */
  get layout(): MultiLayout<GranularRectLayout<unknown>, unknown> {
    if (!this.cachedLayout || !this.cachedLayoutIsValid(this.cachedLayout)) {
      this.cachedLayout = {
        layout: this.makeLayout(),
        props: this.props,
      }
    }
    return this.cachedLayout.layout
  }
}

export default class SubtrackFeatureRenderer extends BoxRendererType {
  // TODO: Implement SVG rendering for subtracks
  supportsSVG = false

  // NOTE: the renderer deliberately holds NO cross-block height state. It used
  // to accumulate min/max heights per refName here, which ratcheted upward
  // forever (lanes could grow but never shrink) and left already-rendered
  // blocks stranded at stale offsets. Lane geometry is now owned by
  // SubtrackFeatureDisplay and arrives via renderProps.subtrackLaneHeights.

  /**
   * Override to create our custom layout session with MultiLayout
   */
  createLayoutSession(props: LayoutSessionProps) {
    return new SubtrackLayoutSession(props)
  }

  /**
   * PrecomputedLayout's constructor only picks up
   * {rectangles, totalHeight, maxHeightReached}, so the per-lane content
   * heights we serialized into the layout would be dropped on the way back
   * into the client. Reattach them -- the display reads them off block.layout
   * to work out the shared lane geometry.
   */
  deserializeLayoutInClient(json: SerializedLayout) {
    const layout = super.deserializeLayoutInClient(json)
    ;(layout as any).subtrackContentHeights = (
      json as any
    ).subtrackContentHeights
    return layout
  }

  /**
   * Override to handle MultiLayout serialization.
   * MultiLayout doesn't have serializeRegion, but its sublayouts do.
   * We completely override to avoid parent's serializeRegion call.
   */
  serializeResultsInWorker(
    results: any,
    args: RenderArgsDeserialized,
  ): any {
    // Extract everything we need from results
    const {
      reactElement,
      features,
      layout: resultLayout,
      height,
      width,
      subtrackContentHeights,
      ...rest
    } = results

    // Manually do what FeatureRendererType does: serialize features
    let serializedFeatures: any[] | undefined
    if (features instanceof Map) {
      serializedFeatures = Array.from(features.values(), f => f.toJSON())
    } else if (Array.isArray(features)) {
      // Already an array, just serialize
      serializedFeatures = features.map((f: any) =>
        typeof f.toJSON === 'function' ? f.toJSON() : f
      )
    } else {
      serializedFeatures = undefined
    }

    const region = args.regions[0]!

    // Serialize layout - handle MultiLayout specially
    let layout: SerializedLayout
    if (resultLayout && typeof resultLayout.toJSON === 'function' && 'subLayouts' in resultLayout) {
      // This is a MultiLayout - serialize it by merging sublayouts
      const sublayoutsData = resultLayout.toJSON()

      // Merge all sublayout rectangles into a single rectangles object
      const rectangles: Record<string, any> = {}
      let maxHeightReached = false

      for (const [, sublayoutData] of Object.entries(sublayoutsData)) {
        const data = sublayoutData as SerializedLayout
        Object.assign(rectangles, data.rectangles)
        maxHeightReached = maxHeightReached || data.maxHeightReached
      }

      // CRITICAL: Use the height we calculated in doAll(), not the max sublayout height!
      // Sublayouts overlap at Y=0, we apply yOffsets during rendering
      layout = {
        rectangles,
        totalHeight: height || 100, // Use the calculated total height from results
        maxHeightReached,
      }
    } else if (resultLayout && 'serializeRegion' in resultLayout) {
      // Single layout with serializeRegion (standard case)
      layout = resultLayout.serializeRegion(this.getExpandedRegion(region, args))
    } else {
      // Already serialized
      layout = resultLayout as SerializedLayout
    }

    // Filter features to only those visible in the layout
    const visibleFeatures = serializedFeatures
      ? serializedFeatures.filter((f: any) => !!layout.rectangles[f.uniqueId])
      : undefined

    // Core only preserves {reactElement, features, layout, maxHeightReached,
    // renderProps, renderArgs} from a render result onto the block model --
    // any other top-level field is dropped. `layout` is the one channel that
    // survives, so the per-lane content heights ride along inside it. The
    // display reads them back off block.layout.
    return {
      ...rest,
      layout: { ...layout, subtrackContentHeights },
      maxHeightReached: layout.maxHeightReached,
      features: visibleFeatures,
      width,
      height,
    }
  }

  async render(renderProps: RenderArgsDeserialized) {
    const features = await this.getFeatures(renderProps)

    const { regions, bpPerPx, config } = renderProps
    const region = regions[0]!

    // Get or create layout session - this persists across renders
    // Layout is cached and reused unless bpPerPx or config changes
    // getWorkerSession() is declared as returning the base LayoutSessionLike, so
    // its `layout` comes back base-typed. createLayoutSession() above always
    // builds a SubtrackLayoutSession, whose layout is the MultiLayout.
    const session = this.getWorkerSession(
      renderProps,
    ) as unknown as SubtrackLayoutSession
    const { layout } = session

    // CRITICAL: Clear the region we're about to render to prevent accumulation
    // For MultiLayout, we need to clear each sublayout (one per subtrack)
    // Get expanded region for clearing (includes padding for labels/glyphs)
    const expandedRegion = this.getExpandedRegion(region, renderProps)

    // Clear exactly the lanes doAll is about to lay out -- which means resolving
    // the subtrack list the SAME way it does: the display's choice from
    // renderProps first, the config only as a fallback. Clearing by the config
    // list instead would discard ranges for lanes we no longer draw AND skip the
    // sublayout of a lane the user just switched on, leaving stale rectangles in
    // it that accumulate across renders.
    const subtracks = ((renderProps as any).subtracks ??
      readConfObject(config, 'subtracks') ??
      []) as Subtrack[]
    for (const subtrack of subtracks) {
      if (subtrack.visible !== false) {
        // Use the same buildLayoutKey function that layoutFeatures uses
        const layoutKey = buildLayoutKey(expandedRegion.refName, subtrack.label)
        layout.discardRange(layoutKey, expandedRegion.start, expandedRegion.end)
      }
    }

    const width = Math.max(1, (region.end - region.start) / bpPerPx)

    const res = await doAll({
      pluginManager: this.pluginManager,
      renderProps,
      layout,
      features,
    })

    // Height is calculated in doAll() and returned in res.height.
    // maxHeightReached is NOT set here: doAll does not produce one, and
    // serializeResultsInWorker derives the real value from the serialized
    // layout's sublayouts anyway.
    const height = res.height ?? 100

    return {
      ...res,
      features, // Keep as Map for serializeResultsInWorker
      layout,
      height,
      width,
    }
  }
}
