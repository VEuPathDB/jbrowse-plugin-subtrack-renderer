/**
 * The viewport rescale, as arithmetic. No JBrowse imports, so it is testable
 * without a runtime — the same boundary `resolveSubtracks` keeps.
 *
 * A syntenic gene's stored position is a per-gene liftover onto the reference,
 * which is accurate per gene and lossy between them: paralogs collapse onto one
 * reference gene and insertions in the syntenic genome compress to nothing.
 * Recomputing positions from the genes' own coordinates, across the window
 * being drawn, restores both. It is the arithmetic of the JBrowse 1 feature
 * API's `sscale`/`scaled_syngenes` CTEs, which is why it depends on the window:
 * the bounding box is taken over the genes in it.
 */

export interface SyntenyGene {
  id: string
  /** which span this gene belongs to; each rescales independently */
  syntenyId: string
  /** the stored liftover position, and the fallback when a gene cannot rescale */
  start: number
  end: number
  /** the gene's position on its own genome, which is what spaces them */
  nativeStart: number
  nativeEnd: number
  /** whether the span runs antiparallel to the reference */
  spanIsReversed: boolean
}

export interface Placement {
  start: number
  end: number
}

interface Box {
  synMin: number
  synSpan: number
  refMin: number
  refMax: number
  refSpan: number
}

/**
 * Spans (`max - min`), not lengths (`max - min + 1`). The JBrowse 1 SQL used
 * lengths, which puts the lowest gene one scale-unit past `refMin` and the
 * highest one past `refMax` — so a gene could be placed outside the reference
 * extent of its own span. Spans make the box's extremes map to the box's
 * extremes exactly. The difference is about a base pair.
 */
function boxOf(genes: SyntenyGene[]): Box | undefined {
  if (genes.length < 2) {
    // one gene carries no spacing information: there is nothing to interpolate
    // between, and its stored position is the best answer available
    return undefined
  }
  let synMin = Infinity
  let synMax = -Infinity
  let refMin = Infinity
  let refMax = -Infinity
  for (const g of genes) {
    synMin = Math.min(synMin, g.nativeStart)
    synMax = Math.max(synMax, g.nativeEnd)
    refMin = Math.min(refMin, g.start)
    refMax = Math.max(refMax, g.end)
  }
  const synSpan = synMax - synMin
  const refSpan = refMax - refMin
  return synSpan > 0 && refSpan > 0
    ? { synMin, synSpan, refMin, refMax, refSpan }
    : undefined
}

function place(gene: SyntenyGene, box: Box): Placement {
  const frac = (coord: number) => (coord - box.synMin) / box.synSpan
  const [a, b] = gene.spanIsReversed
    ? [
        box.refMax - frac(gene.nativeEnd) * box.refSpan,
        box.refMax - frac(gene.nativeStart) * box.refSpan,
      ]
    : [
        box.refMin + frac(gene.nativeStart) * box.refSpan,
        box.refMin + frac(gene.nativeEnd) * box.refSpan,
      ]
  return { start: Math.round(a), end: Math.round(b) }
}

/**
 * Where each gene draws, keyed by id. Genes are grouped by span and each span's
 * box is taken over the genes present — so a gene's placement depends on what
 * else was fetched, which is the point and also the cost: the same gene lands
 * differently in a different window.
 *
 * A span contributing one gene is returned at its stored position rather than
 * dropped, so a lane never silently loses features at its edges.
 */
export function rescaleToWindow(
  genes: SyntenyGene[],
): ReadonlyMap<string, Placement> {
  const bySpan = new Map<string, SyntenyGene[]>()
  for (const gene of genes) {
    let bucket = bySpan.get(gene.syntenyId)
    if (!bucket) {
      bucket = []
      bySpan.set(gene.syntenyId, bucket)
    }
    bucket.push(gene)
  }

  const out = new Map<string, Placement>()
  for (const bucket of bySpan.values()) {
    const box = boxOf(bucket)
    for (const gene of bucket) {
      out.set(
        gene.id,
        box ? place(gene, box) : { start: gene.start, end: gene.end },
      )
    }
  }
  return out
}
