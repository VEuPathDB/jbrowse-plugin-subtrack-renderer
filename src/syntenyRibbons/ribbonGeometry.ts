/**
 * Which boxes to shade between, and where. No React, no JBrowse, no canvas, so
 * the pairing rule is testable without any of them.
 *
 * A ribbon joins two boxes of the same ortholog group in adjacent lanes. The
 * JBrowse 1 track did this by walking its per-lane layouts and, for each box,
 * scanning DOWN until it found a lane containing an ortholog — so a group
 * missing from the lane immediately below still joins across the gap, and a
 * group present in six lanes draws five ribbons rather than fifteen. That rule
 * is kept, because drawing every pair is both wrong-looking and quadratic.
 */

/** One laid-out feature, as the display's `featureItemMap` reports it. */
export interface RibbonBox {
  /** the lane (facet section) this box sits in */
  group: string
  /** what pairs it with boxes in other lanes */
  orthologGroup: string
  startBp: number
  endBp: number
  topPx: number
  bottomPx: number
}

export interface Ribbon {
  orthologGroup: string
  from: RibbonBox
  to: RibbonBox
}

/**
 * Lane order is the order the sections stack, which the caller reads off
 * `groupSections` — not the order boxes happen to arrive in, and not sorted
 * alphabetically, or a ribbon would cross lanes it does not touch.
 */
export function buildRibbons(
  boxes: readonly RibbonBox[],
  laneOrder: readonly string[],
): Ribbon[] {
  const rank = new Map(laneOrder.map((lane, i) => [lane, i]))

  // group -> lane rank -> boxes, so the downward scan is a lookup per lane
  const byOrtholog = new Map<string, Map<number, RibbonBox[]>>()
  for (const box of boxes) {
    if (!box.orthologGroup) {
      continue
    }
    const at = rank.get(box.group)
    if (at === undefined) {
      continue
    }
    let lanes = byOrtholog.get(box.orthologGroup)
    if (!lanes) {
      lanes = new Map()
      byOrtholog.set(box.orthologGroup, lanes)
    }
    const bucket = lanes.get(at)
    if (bucket) {
      bucket.push(box)
    } else {
      lanes.set(at, [box])
    }
  }

  const out: Ribbon[] = []
  for (const [orthologGroup, lanes] of byOrtholog) {
    const occupied = [...lanes.keys()].sort((a, b) => a - b)
    for (let i = 0; i + 1 < occupied.length; i++) {
      // the next lane that HAS this group, not the next lane
      for (const from of lanes.get(occupied[i]!)!) {
        for (const to of lanes.get(occupied[i + 1]!)!) {
          out.push({ orthologGroup, from, to })
        }
      }
    }
  }
  return out
}

/** A ribbon as four corners in screen space, ready to fill. */
export interface RibbonPolygon {
  orthologGroup: string
  points: [number, number][]
}

/**
 * Screen-space corners for a ribbon: the bottom edge of the upper box joined to
 * the top edge of the lower one. `bpToPx` is the view's, so a ribbon lands on
 * the same x as the glyph it leaves.
 *
 * Returns undefined when either box is off-screen horizontally, since a
 * quadrilateral with both edges past the viewport is cheaper to drop than to
 * clip.
 */
export function ribbonPolygon(
  ribbon: Ribbon,
  bpToPx: (bp: number) => number,
  scrollTop: number,
  viewWidth: number,
): RibbonPolygon | undefined {
  const x1 = bpToPx(ribbon.from.startBp)
  const x2 = bpToPx(ribbon.from.endBp)
  const x3 = bpToPx(ribbon.to.endBp)
  const x4 = bpToPx(ribbon.to.startBp)
  if (
    Math.max(x1, x2, x3, x4) < 0 ||
    Math.min(x1, x2, x3, x4) > viewWidth ||
    [x1, x2, x3, x4].some(x => !Number.isFinite(x))
  ) {
    return undefined
  }
  // upper box's bottom edge, then lower box's top edge, traced so the polygon
  // does not self-cross when the two boxes are in opposite orientations
  const yTop = ribbon.from.bottomPx - scrollTop
  const yBottom = ribbon.to.topPx - scrollTop
  return {
    orthologGroup: ribbon.orthologGroup,
    points: [
      [x1, yTop],
      [x2, yTop],
      [x3, yBottom],
      [x4, yBottom],
    ],
  }
}
