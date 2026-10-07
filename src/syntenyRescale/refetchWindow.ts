/**
 * How often a viewport-dependent fetch is allowed to re-issue.
 *
 * Positions computed against the window have to be recomputed when the window
 * moves, but the display only refetches when the object its `zoomFetchArgs()`
 * returns changes — so the way to ask for a refetch is to return something that
 * moves with the viewport. Returning the raw viewport would refetch on every
 * frame of a drag; quantizing trades exactness of the rescale for a bounded
 * fetch rate.
 *
 * Pure, so the cadence is testable without a view.
 */

/** The quantized window a fetch is issued for. Equal objects, equal fetch. */
export interface RefetchWindow {
  refName: string
  bucket: number
  width: number
}

/**
 * Buckets the viewport's centre by a fraction of its own width, so the cadence
 * scales with zoom: a step is a fixed share of the screen whether the view spans
 * ten kilobases or ten megabases.
 *
 * `width` is part of the key because a zoom that keeps the centre still must
 * still refetch — it changes which genes are in the box the rescale is computed
 * over.
 */
export function refetchWindowOf(
  view: { refName: string; start: number; end: number },
  stepFraction: number,
): RefetchWindow {
  const width = Math.max(1, view.end - view.start)
  const step = Math.max(1, width * stepFraction)
  const centre = (view.start + view.end) / 2
  return {
    refName: view.refName,
    bucket: Math.round(centre / step),
    width: Math.round(Math.log2(width) * 4),
  }
}
