import { facetedSubtrackModelF } from './facetedSubtrackModel'
import { toRows } from './toRows'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  {
    label: 'Pf 3D7',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: '3D7' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: 'HB3' },
    visible: true,
  },
  {
    label: 'Pv Sal-1',
    featureFilters: { organism: 'P. vivax' },
    metadata: { strain: 'Sal-1' },
    visible: false,
  },
]

function make(selected: string[] = ['Pf 3D7'], catalog: Subtrack[] = CATALOG) {
  const model = facetedSubtrackModelF().create({ selected })
  model.setRows(toRows(catalog))
  return model
}

describe('facetedSubtrackModel', () => {
  it('exposes facet keys derived from the rows', () => {
    expect(make().facetKeys).toEqual(['organism', 'strain'])
  })

  it('toggling a row on slots it into its catalog position', () => {
    const model = make(['Pf 3D7'])

    model.toggle('Pv Sal-1')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pv Sal-1'])
  })

  it('checking lanes in a scrambled sequence still yields catalog order', () => {
    // JBrowse 1 used click order, which is arbitrary; the catalog is not
    const model = make([])

    model.toggle('Pv Sal-1')
    model.toggle('Pf 3D7')
    model.toggle('Pf HB3')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pf HB3', 'Pv Sal-1'])
  })

  it('appends to the bottom once the user has hand-ordered the lanes', () => {
    const model = make(['Pf 3D7', 'Pv Sal-1'])
    model.move(1, 0)
    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7'])

    model.toggle('Pf HB3')

    // catalog position would be index 1; a hand-made arrangement outranks it
    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7', 'Pf HB3'])
  })

  it('reports whether the lane order is still catalog order', () => {
    const model = make(['Pf 3D7', 'Pf HB3'])
    expect(model.isInCatalogOrder).toBe(true)

    model.move(1, 0)

    expect(model.isInCatalogOrder).toBe(false)
  })

  it('toggling a row off removes it without disturbing the rest', () => {
    const model = make(['Pf 3D7', 'Pf HB3', 'Pv Sal-1'])

    model.toggle('Pf HB3')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pv Sal-1'])
  })

  it('toggling a row off never reorders the survivors', () => {
    const model = make(['Pv Sal-1', 'Pf HB3', 'Pf 3D7'])

    model.toggle('Pf HB3')

    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7'])
  })

  it('moves a lane to a new position', () => {
    const model = make(['Pf 3D7', 'Pf HB3', 'Pv Sal-1'])

    model.move(2, 0)

    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7', 'Pf HB3'])
  })

  it('drops selected ids that no longer exist in the catalog', () => {
    // a phantom lane -- invisible in the table, impossible to uncheck, yet still
    // counted by canApply and still shipped to the display on Apply
    const model = make(['Pf 3D7', 'Pf 7G8-retired'])

    expect(model.selected.slice()).toEqual(['Pf 3D7'])
  })

  it('resolves the selected ids to rows in lane order', () => {
    const model = make(['Pv Sal-1', 'Pf 3D7'])

    expect(model.selectedRows.map(r => r.name)).toEqual(['Pv Sal-1', 'Pf 3D7'])
  })

  it('filters rows by text across name and every field', () => {
    const model = make()

    model.setFilterText('vivax')

    expect(model.filteredRows.map(r => r.id)).toEqual(['Pv Sal-1'])
  })

  it('filters rows by facet', () => {
    const model = make()

    model.setFilter('organism', ['P. vivax'])

    expect(model.filteredRows.map(r => r.id)).toEqual(['Pv Sal-1'])
  })

  it('combines a facet filter with a text filter', () => {
    const model = make()

    model.setFilter('organism', ['P. falciparum'])
    model.setFilterText('HB3')

    expect(model.filteredRows.map(r => r.id)).toEqual(['Pf HB3'])
  })

  it('clearing filters restores every row', () => {
    const model = make()
    model.setFilter('organism', ['P. vivax'])
    model.setFilterText('Sal')

    model.clearFilters()

    expect(model.filteredRows).toHaveLength(3)
  })

  it('filtering the table never disturbs the lane order', () => {
    const model = make(['Pv Sal-1', 'Pf 3D7'])

    model.setFilter('organism', ['P. falciparum'])

    // the point of the two-pane design: order is a property of the selected
    // set, not of the catalog view
    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7'])
  })

  it('reports whether it can be applied', () => {
    expect(make([]).canApply).toBe(false)
    expect(make(['Pf 3D7']).canApply).toBe(true)
  })

  it('sorts the display rows by a column, and flips direction on re-click', () => {
    const model = make()

    model.setSort('strain')

    expect(model.sortDir).toBe('asc')
    expect(model.displayRows.map(r => r.id)).toEqual([
      'Pf 3D7',
      'Pf HB3',
      'Pv Sal-1',
    ])

    model.setSort('strain')

    expect(model.sortDir).toBe('desc')
    expect(model.displayRows.map(r => r.id)).toEqual([
      'Pv Sal-1',
      'Pf HB3',
      'Pf 3D7',
    ])
  })

  it('unsorted display rows are the filtered rows, in catalog order', () => {
    const model = make()

    expect(model.sortBy).toBeUndefined()
    expect(model.displayRows.map(r => r.id)).toEqual(
      model.filteredRows.map(r => r.id),
    )
    expect(model.displayRows.map(r => r.id)).toEqual([
      'Pf 3D7',
      'Pf HB3',
      'Pv Sal-1',
    ])
  })

  it('sorting the table never disturbs the lane order', () => {
    const model = make(['Pv Sal-1', 'Pf 3D7'])

    model.setSort('strain')
    model.setSort('strain')

    // sorting is a browsing aid; it says nothing about which lanes are selected
    // or in what order they render
    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7'])
  })

  it('sorting never reorders the catalog rows themselves', () => {
    const model = make()

    model.setSort('strain')
    model.setSort('strain')

    // rows is the reference frame the default lane order is derived from, so
    // catalog order has to stay recoverable
    expect(model.rows.map(r => r.id)).toEqual(['Pf 3D7', 'Pf HB3', 'Pv Sal-1'])
    model.setSort(undefined)
    expect(model.displayRows.map(r => r.id)).toEqual([
      'Pf 3D7',
      'Pf HB3',
      'Pv Sal-1',
    ])
  })

  it('sorts rows missing the sort key last, in both directions', () => {
    const model = make(
      [],
      [
        ...CATALOG,
        {
          label: 'Pf mystery',
          featureFilters: {},
          metadata: {},
          visible: true,
        },
      ],
    )

    model.setSort('strain')

    expect(model.displayRows.at(-1)?.id).toBe('Pf mystery')

    model.setSort('strain')

    // a missing value is not "less than" anything -- flipping the direction
    // must not shuffle it to the top
    expect(model.displayRows.at(-1)?.id).toBe('Pf mystery')
  })

  it('sorts the filtered subset, not the whole catalog', () => {
    const model = make()

    model.setFilter('organism', ['P. falciparum'])
    model.setSort('strain')

    expect(model.displayRows.map(r => r.id)).toEqual(['Pf 3D7', 'Pf HB3'])

    model.setSort('strain')

    expect(model.displayRows.map(r => r.id)).toEqual(['Pf HB3', 'Pf 3D7'])
  })
})
