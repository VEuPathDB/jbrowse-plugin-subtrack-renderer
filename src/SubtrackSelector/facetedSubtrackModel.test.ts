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

function make(selected: string[] = ['Pf 3D7']) {
  const model = facetedSubtrackModelF().create({ selected })
  model.setRows(toRows(CATALOG))
  return model
}

describe('facetedSubtrackModel', () => {
  it('exposes facet keys derived from the rows', () => {
    expect(make().facetKeys).toEqual(['organism', 'strain'])
  })

  it('toggling a row on appends it to the end of the lane order', () => {
    const model = make(['Pf 3D7'])

    model.toggle('Pv Sal-1')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pv Sal-1'])
  })

  it('toggling a row off removes it without disturbing the rest', () => {
    const model = make(['Pf 3D7', 'Pf HB3', 'Pv Sal-1'])

    model.toggle('Pf HB3')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pv Sal-1'])
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
})
