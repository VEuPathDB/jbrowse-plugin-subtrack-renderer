import { refetchWindowOf } from './refetchWindow'

const STEP = 0.25

function at(start: number, end: number, refName = 'chr1') {
  return refetchWindowOf({ refName, start, end }, STEP)
}

describe('refetchWindowOf', () => {
  it('is unchanged by a pan smaller than the step', () => {
    expect(at(100000, 200000)).toEqual(at(101000, 201000))
  })

  it('changes once a pan crosses the step', () => {
    expect(at(100000, 200000)).not.toEqual(at(130000, 230000))
  })

  it('scales its step with the zoom', () => {
    // the same 3kb pan is below the step at 100kb wide and above it at 4kb wide
    expect(at(100000, 200000)).toEqual(at(103000, 203000))
    expect(at(100000, 104000)).not.toEqual(at(103000, 107000))
  })

  it('changes on a zoom that holds the centre still', () => {
    // a zoom changes which genes the rescale is computed over, even though
    // nothing moved
    expect(at(100000, 200000)).not.toEqual(at(125000, 175000))
  })

  it('tolerates a zoom too small to change the bucket', () => {
    expect(at(100000, 200000)).toEqual(at(100100, 199900))
  })

  it('separates identical coordinates on different sequences', () => {
    expect(at(100000, 200000, 'chr1')).not.toEqual(at(100000, 200000, 'chr2'))
  })

  it('does not divide by zero on an empty viewport', () => {
    expect(() => at(500, 500)).not.toThrow()
    expect(Number.isFinite(at(500, 500).bucket)).toBe(true)
  })
})
