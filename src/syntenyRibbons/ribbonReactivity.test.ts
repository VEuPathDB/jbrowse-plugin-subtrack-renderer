import { autorun, observable, runInAction } from 'mobx'

import { buildRibbons, ribbonPolygon } from './ribbonGeometry'

import type { RibbonBox } from './ribbonGeometry'

/**
 * The overlay went stale on pan and zoom while looking correct on first paint,
 * because the view was read inside the canvas `draw` closure — which runs from
 * an effect, outside mobx's tracking — rather than during render.
 *
 * This pins the property that fixes it: the geometry must be derived from a
 * tracked read, so a pan or a zoom invalidates it. It models the component as
 * the autorun it effectively is, since asserting on the real one needs a view.
 */
describe('ribbon geometry reacts to the view', () => {
  function harness() {
    const view = observable({ offsetPx: 0, bpPerPx: 1 })
    const boxes: RibbonBox[] = [
      {
        group: 'a',
        orthologGroup: 'OG1',
        startBp: 100,
        endBp: 200,
        topPx: 0,
        bottomPx: 10,
      },
      {
        group: 'b',
        orthologGroup: 'OG1',
        startBp: 100,
        endBp: 200,
        topPx: 40,
        bottomPx: 50,
      },
    ]
    const frames: (number | undefined)[] = []
    const stop = autorun(() => {
      // what the render body does: read the view, then build geometry
      const { offsetPx, bpPerPx } = view
      const bpToPx = (bp: number) => bp / bpPerPx - offsetPx
      const [ribbon] = buildRibbons(boxes, ['a', 'b'])
      const poly = ribbon ? ribbonPolygon(ribbon, bpToPx, 0, 10000) : undefined
      frames.push(poly?.points[0]![0])
    })
    return { view, frames, stop }
  }

  it('redraws at a new x when the view pans', () => {
    const { view, frames, stop } = harness()

    runInAction(() => {
      view.offsetPx = 50
    })
    stop()

    expect(frames).toHaveLength(2)
    expect(frames[1]).toBe(frames[0]! - 50)
  })

  it('redraws at a new scale when the view zooms', () => {
    const { view, frames, stop } = harness()

    runInAction(() => {
      view.bpPerPx = 2
    })
    stop()

    expect(frames).toHaveLength(2)
    expect(frames[1]).toBe(50)
  })

  it('does not redraw when nothing it reads has moved', () => {
    const { frames, stop } = harness()
    stop()

    expect(frames).toHaveLength(1)
  })
})
