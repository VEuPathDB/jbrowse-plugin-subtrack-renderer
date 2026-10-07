import { rescaleToWindow } from './rescaleToWindow'

import type { SyntenyGene } from './rescaleToWindow'

function gene(part: Partial<SyntenyGene> & { id: string }): SyntenyGene {
  return {
    syntenyId: 's1',
    start: 0,
    end: 0,
    nativeStart: 0,
    nativeEnd: 0,
    spanIsReversed: false,
    ...part,
  }
}

describe('rescaleToWindow', () => {
  it('spreads genes crammed by the liftover back apart', () => {
    // the paralog case: three genes the liftover stacked on one reference gene,
    // cleanly separated on their own genome
    const genes = [
      gene({
        id: 'a',
        start: 1000,
        end: 1100,
        nativeStart: 5000,
        nativeEnd: 5100,
      }),
      gene({
        id: 'b',
        start: 1010,
        end: 1110,
        nativeStart: 7000,
        nativeEnd: 7100,
      }),
      gene({
        id: 'c',
        start: 1020,
        end: 1120,
        nativeStart: 9000,
        nativeEnd: 9100,
      }),
    ]

    const placed = rescaleToWindow(genes)

    const a = placed.get('a')!
    const b = placed.get('b')!
    const c = placed.get('c')!
    expect(b.start).toBeGreaterThan(a.end)
    expect(c.start).toBeGreaterThan(b.end)
  })

  it('keeps an insertion visible instead of compressing it away', () => {
    // a 50kb gap on the syntenic genome that the liftover renders as ~0
    const genes = [
      gene({
        id: 'l',
        start: 1000,
        end: 1100,
        nativeStart: 1000,
        nativeEnd: 1100,
      }),
      gene({
        id: 'r',
        start: 1105,
        end: 1205,
        nativeStart: 51000,
        nativeEnd: 51100,
      }),
    ]

    const placed = rescaleToWindow(genes)

    const storedGap = 1105 - 1100
    const drawnGap = placed.get('r')!.start - placed.get('l')!.end
    expect(drawnGap).toBeGreaterThan(storedGap * 10)
  })

  it('rescales each span independently', () => {
    const genes = [
      gene({
        id: 'a1',
        syntenyId: 's1',
        start: 100,
        end: 200,
        nativeStart: 100,
        nativeEnd: 200,
      }),
      gene({
        id: 'a2',
        syntenyId: 's1',
        start: 800,
        end: 900,
        nativeStart: 800,
        nativeEnd: 900,
      }),
      gene({
        id: 'b1',
        syntenyId: 's2',
        start: 5000,
        end: 5100,
        nativeStart: 10,
        nativeEnd: 110,
      }),
      gene({
        id: 'b2',
        syntenyId: 's2',
        start: 5800,
        end: 5900,
        nativeStart: 710,
        nativeEnd: 810,
      }),
    ]

    const placed = rescaleToWindow(genes)

    // s2's genes stay in s2's reference extent; a shared box would drag them
    // toward s1's
    expect(placed.get('b1')!.start).toBeGreaterThanOrEqual(5000)
    expect(placed.get('b2')!.end).toBeLessThanOrEqual(5900)
  })

  it('reverses placement for an antiparallel span', () => {
    const genes = [
      gene({
        id: 'first',
        start: 1000,
        end: 1100,
        nativeStart: 1000,
        nativeEnd: 1100,
        spanIsReversed: true,
      }),
      gene({
        id: 'last',
        start: 1900,
        end: 2000,
        nativeStart: 1900,
        nativeEnd: 2000,
        spanIsReversed: true,
      }),
    ]

    const placed = rescaleToWindow(genes)

    // lowest native coordinate draws at the HIGH end of the reference extent
    expect(placed.get('first')!.start).toBeGreaterThan(
      placed.get('last')!.start,
    )
  })

  it('never inverts a feature', () => {
    const genes = [
      gene({
        id: 'a',
        start: 10,
        end: 20,
        nativeStart: 10,
        nativeEnd: 20,
        spanIsReversed: true,
      }),
      gene({
        id: 'b',
        start: 80,
        end: 90,
        nativeStart: 80,
        nativeEnd: 90,
        spanIsReversed: true,
      }),
    ]

    for (const p of rescaleToWindow(genes).values()) {
      expect(p.end).toBeGreaterThanOrEqual(p.start)
    }
  })

  it('leaves a lone gene at its stored position rather than dropping it', () => {
    // one gene carries no spacing information, and 0/0 is not a position
    const genes = [
      gene({
        id: 'only',
        start: 4242,
        end: 4342,
        nativeStart: 9,
        nativeEnd: 109,
      }),
    ]

    expect(rescaleToWindow(genes).get('only')).toEqual({
      start: 4242,
      end: 4342,
    })
  })

  it('leaves genes alone when every one shares a coordinate', () => {
    const genes = [
      gene({ id: 'a', start: 500, end: 500, nativeStart: 7, nativeEnd: 7 }),
      gene({ id: 'b', start: 500, end: 500, nativeStart: 7, nativeEnd: 7 }),
    ]

    expect(rescaleToWindow(genes).get('a')).toEqual({ start: 500, end: 500 })
  })

  it.each([false, true])(
    'never places a gene outside its span (reversed: %s)',
    reversed => {
      // the JBrowse1 SQL divides by `max - min + 1`, which pushes the extremes
      // one scale-unit past the box and out of the span's own extent
      const genes = [
        gene({
          id: 'a',
          start: 1000,
          end: 1100,
          nativeStart: 10,
          nativeEnd: 110,
          spanIsReversed: reversed,
        }),
        gene({
          id: 'b',
          start: 1400,
          end: 1500,
          nativeStart: 410,
          nativeEnd: 510,
          spanIsReversed: reversed,
        }),
        gene({
          id: 'c',
          start: 1900,
          end: 2000,
          nativeStart: 910,
          nativeEnd: 1010,
          spanIsReversed: reversed,
        }),
      ]

      for (const p of rescaleToWindow(genes).values()) {
        expect(p.start).toBeGreaterThanOrEqual(1000)
        expect(p.end).toBeLessThanOrEqual(2000)
      }
    },
  )

  it('maps the span extremes onto the reference extremes exactly', () => {
    const genes = [
      gene({
        id: 'lo',
        start: 1000,
        end: 1100,
        nativeStart: 10,
        nativeEnd: 110,
      }),
      gene({
        id: 'hi',
        start: 1900,
        end: 2000,
        nativeStart: 910,
        nativeEnd: 1010,
      }),
    ]

    const placed = rescaleToWindow(genes)

    expect(placed.get('lo')!.start).toBe(1000)
    expect(placed.get('hi')!.end).toBe(2000)
  })

  it('places every gene it is given', () => {
    const genes = [
      gene({
        id: 'a',
        syntenyId: 's1',
        start: 1,
        end: 2,
        nativeStart: 1,
        nativeEnd: 2,
      }),
      gene({
        id: 'b',
        syntenyId: 's1',
        start: 9,
        end: 10,
        nativeStart: 9,
        nativeEnd: 10,
      }),
      gene({
        id: 'c',
        syntenyId: 's2',
        start: 3,
        end: 4,
        nativeStart: 3,
        nativeEnd: 4,
      }),
    ]

    expect([...rescaleToWindow(genes).keys()].sort()).toEqual(['a', 'b', 'c'])
  })
})
