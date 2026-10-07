import SyntenyRescaleAdapter from './SyntenyRescaleAdapter'

import type { Feature } from '@jbrowse/core/util/simpleFeature'

/** A GFF-shaped feature: fixed columns, everything else an attribute. */
function feature(
  id: string,
  cols: { type: string; start: number; end: number },
  attrs: Record<string, string>,
): Feature {
  return {
    id: () => id,
    get: (name: string) =>
      name === 'start'
        ? cols.start
        : name === 'end'
          ? cols.end
          : name === 'type'
            ? cols.type
            : attrs[name],
    toJSON: () => ({ uniqueId: id, ...cols, ...attrs }),
  } as unknown as Feature
}

const DEFAULTS: Record<string, unknown> = {
  nativeStartAttribute: 'nativeStart',
  nativeEndAttribute: 'nativeEnd',
  spanAttribute: 'syntenyId',
  reversedAttribute: 'spanIsReversed',
  orthologGroupAttribute: 'orthologGroup',
  rescaleTypes: ['gene'],
  subadapter: {},
}

function adapterOver(features: Feature[], conf: Record<string, unknown> = {}) {
  const adapter = new SyntenyRescaleAdapter()
  // the config the adapter reads; a real one is an MST model, and the adapter
  // only ever asks it for slots by name
  ;(adapter as unknown as { getConf: (n: string) => unknown }).getConf = (
    name: string,
  ) => ({ ...DEFAULTS, ...conf })[name]
  ;(adapter as unknown as { getSub: () => Promise<unknown> }).getSub = () =>
    Promise.resolve({
      getFeaturesArray: () => Promise.resolve(features),
      getRefNames: () => Promise.resolve(['chr1']),
    })
  return adapter
}

async function collect(adapter: SyntenyRescaleAdapter) {
  const out: Feature[] = []
  await new Promise<void>((resolve, reject) => {
    adapter
      .getFeatures({ refName: 'chr1', start: 0, end: 1e6 } as never)
      .subscribe({
        next: f => out.push(f),
        error: reject,
        complete: resolve,
      })
  })
  return out
}

const GENES = [
  feature(
    'g1',
    { type: 'gene', start: 1000, end: 1100 },
    {
      nativeStart: '5000',
      nativeEnd: '5100',
      syntenyId: 's1',
      spanIsReversed: '0',
      orthologGroup: 'OG8_1',
    },
  ),
  feature(
    'g2',
    { type: 'gene', start: 1010, end: 1110 },
    {
      nativeStart: '9000',
      nativeEnd: '9100',
      syntenyId: 's1',
      spanIsReversed: '0',
      orthologGroup: 'OG8_2',
    },
  ),
]

describe('SyntenyRescaleAdapter', () => {
  it('repositions genes against the window', async () => {
    const out = await collect(adapterOver(GENES))

    expect(out).toHaveLength(2)
    // g2 sits 4kb past g1 on its own genome; the liftover had them 10bp apart
    expect(out[1]!.get('start')).toBeGreaterThan(out[0]!.get('end'))
  })

  it('records where each feature came from', async () => {
    const out = await collect(adapterOver(GENES))

    expect(out[0]!.get('rescaledFrom')).toBe('1000-1100')
  })

  it('folds the ortholog group into the feature id', async () => {
    const out = await collect(adapterOver(GENES))

    expect(out[0]!.id()).toContain('OG8_1')
    expect(out[0]!.id()).toContain('g1')
  })

  it('passes through a feature type it does not rescale', async () => {
    const span = feature(
      'sp',
      { type: 'syntenic_region', start: 500, end: 9000 },
      { syntenyId: 's1' },
    )

    const out = await collect(adapterOver([...GENES, span]))

    const placed = out.find(f => f.id().includes('sp'))!
    expect(placed.get('start')).toBe(500)
    expect(placed.get('end')).toBe(9000)
  })

  it('leaves a feature with no native coordinates where it was', async () => {
    const bare = feature(
      'b',
      { type: 'gene', start: 700, end: 800 },
      { syntenyId: 's1' },
    )

    const out = await collect(adapterOver([bare]))

    expect(out[0]!.get('start')).toBe(700)
  })

  it('emits every feature it was given', async () => {
    const out = await collect(adapterOver(GENES))
    expect(out).toHaveLength(GENES.length)
  })

  it('reads attributes that the GFF parser lowercased', async () => {
    // JBrowse's GFF3 reader hands attribute names over in lower case, so a
    // config naming `nativeStart` has to find `nativestart`. This silently
    // rescaled nothing until a browser said so: every feature passed through
    // untouched and the track looked merely unchanged, not broken.
    const lowercased = [
      feature(
        'g1',
        { type: 'gene', start: 1000, end: 1100 },
        {
          nativestart: '5000',
          nativeend: '5100',
          syntenyid: 's1',
          spanisreversed: '0',
          orthologgroup: 'OG8_1',
        },
      ),
      feature(
        'g2',
        { type: 'gene', start: 1010, end: 1110 },
        {
          nativestart: '9000',
          nativeend: '9100',
          syntenyid: 's1',
          spanisreversed: '0',
          orthologgroup: 'OG8_2',
        },
      ),
    ]

    const out = await collect(adapterOver(lowercased))

    expect(out[0]!.get('rescaledFrom')).toBe('1000-1100')
    expect(out[1]!.get('start')).toBeGreaterThan(out[0]!.get('end'))
    expect(out[0]!.id()).toContain('OG8_1')
  })

  it('honours a reversed span given lowercased', async () => {
    const reversed = [
      feature(
        'a',
        { type: 'gene', start: 1000, end: 1100 },
        {
          nativestart: '1000',
          nativeend: '1100',
          syntenyid: 's',
          spanisreversed: '1',
        },
      ),
      feature(
        'b',
        { type: 'gene', start: 1900, end: 2000 },
        {
          nativestart: '1900',
          nativeend: '2000',
          syntenyid: 's',
          spanisreversed: '1',
        },
      ),
    ]

    const out = await collect(adapterOver(reversed))

    // lowest native coordinate draws at the high end when the span is reversed
    expect(out[0]!.get('start')).toBeGreaterThan(out[1]!.get('start'))
  })
})
