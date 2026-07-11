import { types } from '@jbrowse/mobx-state-tree'
import { observable } from 'mobx'

import { filterRows, getFacetCounts, getFacetKeys } from './subtrackRows'

import type { SubtrackRow } from './subtrackRows'
import type { Instance } from '@jbrowse/mobx-state-tree'

/**
 * #stateModel FacetedSubtrackModel
 *
 * Rows in, an ordered list of selected ids out. It knows nothing about
 * SubtrackFeatureDisplay, nothing about tracks, and nothing about what a lane
 * is -- the dialog is the only thing that bridges the two.
 *
 * That boundary is not decoration. It is what would let this be replaced by an
 * upstreamed, generic JBrowse 2 FacetedSelector as a deletion rather than a
 * rewrite. Do not reach into the display from here.
 *
 * `selected` is a WORKING COPY. The dialog is a transaction: nothing touches the
 * display until Apply.
 */
export function facetedSubtrackModelF() {
  return types
    .model('FacetedSubtrackModel', {
      /**
       * #property
       * ordered ids of the selected lanes, top to bottom
       */
      selected: types.array(types.string),
      /**
       * #property
       */
      filterText: types.optional(types.string, ''),
    })
    .volatile(() => ({
      /**
       * #volatile
       */
      rows: [] as SubtrackRow[],
      /**
       * #volatile
       */
      filters: observable.map<string, string[]>(),
    }))
    .actions(self => ({
      /**
       * #action
       */
      setRows(rows: SubtrackRow[]) {
        self.rows = rows
      },
      /**
       * #action
       */
      setFilterText(text: string) {
        self.filterText = text
      },
      /**
       * #action
       */
      setFilter(key: string, values: string[]) {
        self.filters.set(key, values)
      },
      /**
       * #action
       */
      clearFilters() {
        self.filters.clear()
        self.filterText = ''
      },
      /**
       * #action
       * A newly checked lane goes to the bottom, which is the only
       * non-surprising place for it.
       */
      toggle(id: string) {
        const idx = self.selected.indexOf(id)
        if (idx === -1) {
          self.selected.push(id)
        } else {
          self.selected.splice(idx, 1)
        }
      },
      /**
       * #action
       */
      move(from: number, to: number) {
        const [moved] = self.selected.splice(from, 1)
        if (moved !== undefined) {
          self.selected.splice(to, 0, moved)
        }
      },
    }))
    .views(self => ({
      /**
       * #getter
       */
      get facetKeys() {
        return getFacetKeys(self.rows)
      },
      /**
       * #getter
       */
      get filteredRows() {
        return filterRows(self.rows, self.filterText, new Map(self.filters))
      },
      /**
       * #getter
       */
      get selectedSet() {
        return new Set(self.selected)
      },
      /**
       * #getter
       * Zero lanes is not a useful thing to apply, so Apply is disabled rather
       * than silently reverting to defaults the way JBrowse 1 did.
       */
      get canApply() {
        return self.selected.length > 0
      },
    }))
    .views(self => ({
      /**
       * #getter
       */
      get facetCounts() {
        return getFacetCounts(self.rows, self.facetKeys, new Map(self.filters))
      },
    }))
}

export type FacetedSubtrackStateModel = ReturnType<typeof facetedSubtrackModelF>
export type FacetedSubtrackModel = Instance<FacetedSubtrackStateModel>
