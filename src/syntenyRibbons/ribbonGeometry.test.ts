import { buildRibbons, ribbonPolygon, ribbonRefName } from './ribbonGeometry'

import type { RibbonBox } from './ribbonGeometry'

function box(
  group: string,
  orthologGroup: string,
  part: Partial<RibbonBox> = {},
): RibbonBox {
  return {
    group,
    orthologGroup,
    startBp: 100,
    endBp: 200,
    topPx: 0,
    bottomPx: 10,
    ...part,
  }
}

const LANES = ['a', 'b', 'c', 'd']

describe('buildRibbons', () => {
  it('joins the same ortholog group in adjacent lanes', () => {
    const ribbons = buildRibbons([box('a', 'OG1'), box('b', 'OG1')], LANES)

    expect(ribbons).toHaveLength(1)
    expect(ribbons[0]!.from.group).toBe('a')
    expect(ribbons[0]!.to.group).toBe('b')
  })

  it('chains rather than joining every pair', () => {
    // four lanes sharing a group: three ribbons, not six -- JBrowse1 scans down
    // to the FIRST lane with an ortholog and stops
    const ribbons = buildRibbons(
      [box('a', 'OG1'), box('b', 'OG1'), box('c', 'OG1'), box('d', 'OG1')],
      LANES,
    )

    expect(ribbons).toHaveLength(3)
    expect(ribbons.map(r => `${r.from.group}${r.to.group}`).sort()).toEqual([
      'ab',
      'bc',
      'cd',
    ])
  })

  it('skips a lane that lacks the group', () => {
    const ribbons = buildRibbons([box('a', 'OG1'), box('d', 'OG1')], LANES)

    expect(ribbons).toHaveLength(1)
    expect(ribbons[0]!.from.group).toBe('a')
    expect(ribbons[0]!.to.group).toBe('d')
  })

  it('draws nothing for a group present in only one lane', () => {
    expect(buildRibbons([box('a', 'OG1'), box('b', 'OG2')], LANES)).toEqual([])
  })

  it('ignores a box with no ortholog group', () => {
    expect(buildRibbons([box('a', ''), box('b', '')], LANES)).toEqual([])
  })

  it('ignores a box in a lane that is not shown', () => {
    // a hidden lane's boxes must not anchor a ribbon to nothing
    const ribbons = buildRibbons(
      [box('a', 'OG1'), box('hidden', 'OG1'), box('b', 'OG1')],
      LANES,
    )

    expect(ribbons).toHaveLength(1)
    expect(ribbons[0]!.to.group).toBe('b')
  })

  it('joins every pair when a lane holds paralogs', () => {
    // two copies in one lane, one in the next: both get a ribbon, which is the
    // case the whole rescale exists to make visible
    const ribbons = buildRibbons(
      [
        box('a', 'OG1', { startBp: 100 }),
        box('a', 'OG1', { startBp: 400 }),
        box('b', 'OG1'),
      ],
      LANES,
    )

    expect(ribbons).toHaveLength(2)
  })

  it('uses lane order, not the order boxes arrive in', () => {
    const ribbons = buildRibbons([box('c', 'OG1'), box('a', 'OG1')], LANES)

    expect(ribbons[0]!.from.group).toBe('a')
    expect(ribbons[0]!.to.group).toBe('c')
  })
})

describe('ribbonPolygon', () => {
  const ribbon = {
    orthologGroup: 'OG1',
    from: box('a', 'OG1', { topPx: 0, bottomPx: 10 }),
    to: box('b', 'OG1', { topPx: 40, bottomPx: 50 }),
  }
  const bpToPx = (bp: number) => bp

  it('joins the upper box bottom to the lower box top', () => {
    const poly = ribbonPolygon(ribbon, bpToPx, 0, 1000)!

    expect(poly.points.map(p => p[1])).toEqual([10, 10, 40, 40])
  })

  it('subtracts the scroll offset', () => {
    const poly = ribbonPolygon(ribbon, bpToPx, 5, 1000)!

    expect(poly.points.map(p => p[1])).toEqual([5, 5, 35, 35])
  })

  it('drops a ribbon entirely left of the viewport', () => {
    const off = {
      ...ribbon,
      from: box('a', 'OG1', { startBp: -500, endBp: -400 }),
      to: box('b', 'OG1', { startBp: -500, endBp: -400 }),
    }

    expect(ribbonPolygon(off, bpToPx, 0, 1000)).toBeUndefined()
  })

  it('drops a ribbon entirely right of the viewport', () => {
    const off = {
      ...ribbon,
      from: box('a', 'OG1', { startBp: 5000, endBp: 5100 }),
      to: box('b', 'OG1', { startBp: 5000, endBp: 5100 }),
    }

    expect(ribbonPolygon(off, bpToPx, 0, 1000)).toBeUndefined()
  })

  it('keeps a ribbon straddling the viewport edge', () => {
    const straddling = {
      ...ribbon,
      from: box('a', 'OG1', { startBp: -50, endBp: 50 }),
      to: box('b', 'OG1', { startBp: -50, endBp: 50 }),
    }

    expect(ribbonPolygon(straddling, bpToPx, 0, 1000)).toBeDefined()
  })

  it('drops a ribbon whose coordinates do not map', () => {
    // bpToPx answers only inside a displayed region
    expect(ribbonPolygon(ribbon, () => Number.NaN, 0, 1000)).toBeUndefined()
  })
})

describe('ribbonRefName', () => {
  it('names the sequence when the view shows one', () => {
    expect(ribbonRefName([{ refName: 'chr1' }])).toBe('chr1')
  })

  it('still names it when one sequence arrives as several blocks', () => {
    expect(ribbonRefName([{ refName: 'chr1' }, { refName: 'chr1' }])).toBe(
      'chr1',
    )
  })

  it('declines across several sequences', () => {
    // the whole-genome view: coordinates no longer locate a feature, so
    // ribbons would be placed by whichever sequence came first
    expect(
      ribbonRefName([{ refName: 'chr1' }, { refName: 'chr2' }]),
    ).toBeUndefined()
  })

  it('declines when the view shows nothing', () => {
    expect(ribbonRefName([])).toBeUndefined()
  })
})
