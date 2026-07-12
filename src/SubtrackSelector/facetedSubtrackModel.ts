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
    })
    .volatile(() => ({
      /**
       * #volatile
       */
      rows: [] as SubtrackRow[],
      /**
       * #volatile
       * filter state is volatile, not a property: the dialog is a transaction,
       * so snapshotting half of it (text but not facets) would be arbitrary
       */
      filterText: '',
      /**
       * #volatile
       */
      filters: observable.map<string, string[]>(),
      /**
       * #volatile
       * a facet key, or 'name'; undefined means catalog order. Sorting is a
       * BROWSING aid: it reorders a derived view of the table and nothing else.
       */
      sortBy: undefined as string | undefined,
      /**
       * #volatile
       */
      sortDir: 'asc' as 'asc' | 'desc',
    }))
    .views(self => ({
      /**
       * #getter
       * Whether the lane order still agrees with catalog order, i.e. the row
       * indices of `selected` are strictly increasing. Once it is false the user
       * has hand-ordered the lanes and any catalog-derived insertion point is
       * meaningless -- see toggle().
       */
      get isInCatalogOrder() {
        const rank = new Map(self.rows.map((row, i) => [row.id, i]))
        let previous = -1
        for (const id of self.selected) {
          const i = rank.get(id)
          if (i === undefined || i <= previous) {
            return false
          }
          previous = i
        }
        return true
      },
    }))
    .actions(self => ({
      /**
       * #action
       * Reconciles the selection against the new catalog. A selected id with no
       * matching row is a phantom lane: invisible in the table, impossible to
       * uncheck, yet still counted by canApply and still shipped to the display
       * on Apply. A catalog that changed under an open dialog produces exactly
       * that, so drop the unknowns here.
       */
      setRows(rows: SubtrackRow[]) {
        self.rows = rows
        const known = new Set(rows.map(r => r.id))
        self.selected.replace(self.selected.filter(id => known.has(id)))
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
       * Where a newly checked lane lands depends on whether the user has taken
       * ownership of the order yet.
       *
       * While the lane order is still catalog order, the lane slots into its
       * CATALOG position. JBrowse 1 appended in click order instead, which is
       * arbitrary -- the catalog is curated, the sequence of clicks is not.
       *
       * Once anything has been dragged, catalog order is no longer the frame the
       * list is in, so a catalog-derived insertion point would be a guess against
       * neighbours that are no longer sorted by it. Appending to the bottom is
       * visible, draggable, and does not silently disturb a hand-made
       * arrangement.
       *
       * Removal splices out and leaves the rest alone, in both modes.
       */
      toggle(id: string) {
        const idx = self.selected.indexOf(id)
        if (idx !== -1) {
          self.selected.splice(idx, 1)
          return
        }
        const rank = new Map(self.rows.map((row, i) => [row.id, i]))
        const target = rank.get(id)
        if (!self.isInCatalogOrder || target === undefined) {
          self.selected.push(id)
          return
        }
        const at = self.selected.findIndex(
          other => (rank.get(other) ?? -1) > target,
        )
        if (at === -1) {
          self.selected.push(id)
        } else {
          self.selected.splice(at, 0, id)
        }
      },
      /**
       * #action
       * Re-clicking the current column flips the direction; a new column starts
       * ascending. `undefined` clears the sort, restoring catalog order.
       */
      setSort(key: string | undefined) {
        if (key !== undefined && key === self.sortBy) {
          self.sortDir = self.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          self.sortBy = key
          self.sortDir = 'asc'
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
       * the selected rows in lane order -- setRows guarantees every id resolves
       */
      get selectedRows(): SubtrackRow[] {
        const byId = new Map(self.rows.map(r => [r.id, r]))
        return self.selected
          .map(id => byId.get(id))
          .filter((r): r is SubtrackRow => r !== undefined)
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
      /**
       * #getter
       * What the table renders: the filtered rows under the current sort. The
       * sort lives HERE, in a derived view, and never in `rows` -- catalog order
       * is the reference frame the default lane order is derived from, so it has
       * to stay recoverable at all times.
       *
       * A row missing the sort key sorts last in BOTH directions: a missing value
       * is not "less than" anything, and flipping the direction should not
       * shuffle the unknowns to the top. Ties keep catalog order, since sort() is
       * stable.
       */
      get displayRows(): SubtrackRow[] {
        const { sortBy, sortDir } = self
        if (sortBy === undefined) {
          return self.filteredRows
        }
        const direction = sortDir === 'asc' ? 1 : -1
        const valueOf = (row: SubtrackRow) =>
          sortBy === 'name' ? row.name : row.fields[sortBy]

        return [...self.filteredRows].sort((a, b) => {
          const left = valueOf(a)
          const right = valueOf(b)
          if (left === undefined) {
            return right === undefined ? 0 : 1
          }
          if (right === undefined) {
            return -1
          }
          return direction * left.localeCompare(right)
        })
      },
    }))
}

export type FacetedSubtrackStateModel = ReturnType<typeof facetedSubtrackModelF>
export type FacetedSubtrackModel = Instance<FacetedSubtrackStateModel>
