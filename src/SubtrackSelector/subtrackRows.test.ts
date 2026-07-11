import { getFacetCounts, getFacetKeys, toRows } from './subtrackRows'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  {
    label: 'Pf 3D7',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: '3D7', study: 'Ref' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: 'HB3', study: 'Cross' },
    visible: true,
  },
  {
    label: 'Pv Sal-1',
    featureFilters: { organism: 'P. vivax' },
    metadata: { strain: 'Sal-1', study: 'Ref' },
    visible: false,
  },
]

describe('toRows', () => {
  it('merges featureFilters and metadata into one flat field map', () => {
    const rows = toRows(CATALOG)

    expect(rows[0]).toEqual({
      id: 'Pf 3D7',
      name: 'Pf 3D7',
      fields: {
        organism: 'P. falciparum',
        strain: '3D7',
        study: 'Ref',
      },
    })
  })

  it('lets metadata win a key collision with featureFilters', () => {
    const collide: Subtrack[] = [
      {
        label: 'X',
        featureFilters: { organism: 'from-filters' },
        metadata: { organism: 'from-metadata' },
        visible: true,
      },
    ]

    expect(toRows(collide)[0]!.fields.organism).toBe('from-metadata')
  })

  it('stringifies primitive values and skips non-primitives', () => {
    const mixed: Subtrack[] = [
      {
        label: 'X',
        featureFilters: { count: 3, ok: true, types: ['a', 'b'] },
        metadata: { range: { min: 1, max: 2 } as unknown as string },
        visible: true,
      },
    ]

    // arrays and objects are predicates, not descriptors -- they still assign
    // features to a lane, they just are not facetable
    expect(toRows(mixed)[0]!.fields).toEqual({ count: '3', ok: 'true' })
  })

  it('tolerates a subtrack with no metadata at all', () => {
    const bare: Subtrack[] = [
      { label: 'X', featureFilters: { type: 'gene' }, visible: true },
    ]

    expect(toRows(bare)[0]!.fields).toEqual({ type: 'gene' })
  })
})

describe('getFacetKeys', () => {
  it('is the union of all field keys across rows, sorted', () => {
    expect(getFacetKeys(toRows(CATALOG))).toEqual([
      'organism',
      'strain',
      'study',
    ])
  })
})

describe('getFacetCounts', () => {
  const rows = toRows(CATALOG)
  const keys = getFacetKeys(rows)

  it('counts every value of every facet when nothing is filtered', () => {
    const counts = getFacetCounts(rows, keys, new Map())

    expect(counts.get('organism')).toEqual(
      new Map([
        ['P. falciparum', 2],
        ['P. vivax', 1],
      ]),
    )
    expect(counts.get('study')).toEqual(
      new Map([
        ['Ref', 2],
        ['Cross', 1],
      ]),
    )
  })

  it('drills down: a filtered facet still counts against the pre-filter rows', () => {
    // the non-obvious bit, copied from JBrowse 2's FacetFilters.tsx -- selecting
    // P. falciparum must NOT zero out P. vivax in its own facet, or the user can
    // never widen their selection again
    const filters = new Map([['organism', ['P. falciparum']]])
    const counts = getFacetCounts(rows, keys, filters)

    expect(counts.get('organism')).toEqual(
      new Map([
        ['P. falciparum', 2],
        ['P. vivax', 1],
      ]),
    )
    // but OTHER facets are narrowed by the organism filter
    expect(counts.get('study')).toEqual(
      new Map([
        ['Ref', 1],
        ['Cross', 1],
      ]),
    )
  })
})
