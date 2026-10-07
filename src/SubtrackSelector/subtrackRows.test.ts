import { filterRows, getFacetCounts, getFacetKeys } from './subtrackRows'
import { toRows } from './toRows'

import type { Lane as Subtrack } from '../subtrackCatalog'

const CATALOG: Subtrack[] = [
  {
    label: 'Pf 3D7',
    metadata: { organism: 'P. falciparum', strain: '3D7', study: 'Ref' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    metadata: { organism: 'P. falciparum', strain: 'HB3', study: 'Cross' },
    visible: true,
  },
  {
    label: 'Pv Sal-1',
    metadata: { organism: 'P. vivax', strain: 'Sal-1', study: 'Ref' },
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

  // Deleted with JBrowse 5: a test that metadata won a key collision with
  // `featureFilters`. Lane assignment moved into the data, `featureFilters` is
  // gone from the catalog, and metadata is the sole facet source -- so there is
  // no longer a collision for either side to win.

  it('stringifies primitive values and skips non-primitives', () => {
    const mixed: Subtrack[] = [
      {
        label: 'X',
        metadata: {
          count: 3,
          ok: true,
          types: ['a', 'b'],
          range: { min: 1, max: 2 },
        } as unknown as Record<string, string>,
        visible: true,
      },
    ]

    // arrays and objects are predicates, not descriptors -- they still assign
    // features to a lane, they just are not facetable
    expect(toRows(mixed)[0]!.fields).toEqual({ count: '3', ok: 'true' })
  })

  it('tolerates a subtrack with no metadata at all', () => {
    const bare: Subtrack[] = [
      { label: 'X', metadata: { type: 'gene' }, visible: true },
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

  it('counts a facet against EVERY other active filter, not just the earlier ones', () => {
    // the regression guard for the bug we inherited from JBrowse 2's
    // FacetFilters.tsx: it narrows an accumulator in key order, so `organism`
    // (sorted first) never saw the `study` filter and advertised "P. vivax (2)"
    // when clicking it would in fact yield 1 row
    const square = toRows([
      {
        label: 'Pf Ref',
        metadata: { organism: 'P. falciparum', study: 'Ref' },
        visible: true,
      },
      {
        label: 'Pf Cross',
        metadata: { organism: 'P. falciparum', study: 'Cross' },
        visible: true,
      },
      {
        label: 'Pv Ref',
        metadata: { organism: 'P. vivax', study: 'Ref' },
        visible: true,
      },
      {
        label: 'Pv Cross',
        metadata: { organism: 'P. vivax', study: 'Cross' },
        visible: true,
      },
    ])
    const filters = new Map([
      ['organism', ['P. falciparum']],
      ['study', ['Ref']],
    ])

    const counts = getFacetCounts(square, getFacetKeys(square), filters)

    // organism is counted against study=Ref, ignoring only its own filter
    expect(counts.get('organism')).toEqual(
      new Map([
        ['P. falciparum', 1],
        ['P. vivax', 1],
      ]),
    )
    // and study is counted against organism=P. falciparum, symmetrically
    expect(counts.get('study')).toEqual(
      new Map([
        ['Ref', 1],
        ['Cross', 1],
      ]),
    )
  })
})

describe('filterRows', () => {
  const rows = toRows(CATALOG)

  it('drops a row that lacks the filtered facet key entirely', () => {
    // metadata is optional, so heterogeneous catalogs are normal
    const mixed = toRows([
      ...CATALOG,
      {
        label: 'No study',
        metadata: { organism: 'P. vivax' },
        visible: true,
      },
    ])

    const filtered = filterRows(mixed, '', new Map([['study', ['Ref']]]))

    expect(filtered.map(r => r.id)).toEqual(['Pf 3D7', 'Pv Sal-1'])
  })

  it('treats an empty values array as an inactive facet', () => {
    // what unchecking the last box in a facet produces
    const filtered = filterRows(rows, '', new Map([['organism', []]]))

    expect(filtered).toHaveLength(3)
  })

  it('ORs multiple values within one facet', () => {
    const filtered = filterRows(
      rows,
      '',
      new Map([['organism', ['P. falciparum', 'P. vivax']]]),
    )

    expect(filtered).toHaveLength(3)
  })

  it('matches text case-insensitively across name and fields', () => {
    expect(filterRows(rows, 'sAl-1', new Map()).map(r => r.id)).toEqual([
      'Pv Sal-1',
    ])
    expect(filterRows(rows, 'CROSS', new Map()).map(r => r.id)).toEqual([
      'Pf HB3',
    ])
  })
})
