import type { SubtrackRow } from './subtrackRows'
import type { Lane as Subtrack } from '../subtrackCatalog'

/**
 * Only primitive values become facets. An array or a {min,max} range is a
 * predicate, not a descriptor -- it still assigns features to a lane, it just
 * makes no sense as a column to filter the selector on. Same rule as JBrowse 2's
 * getRootKeys().
 */
function flatten(obj: Record<string, unknown> | undefined) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (value !== null && value !== undefined && typeof value !== 'object') {
      out[key] = String(value)
    }
  }
  return out
}

/**
 * A lane's facetable columns are its `metadata`, and only its primitives -- an
 * array or a range is a predicate, not a descriptor, and makes no sense as a
 * column to filter the selector on.
 *
 * Until JBrowse 5 this merged `featureFilters` in first, the JBrowse 1 trick of
 * letting the lane-assignment predicate double as the facet columns. Assignment
 * now lives in the data, which carries a `subtrack` attribute that JBrowse
 * facets on directly, so metadata is the sole source and the two concerns stop
 * being conflated.
 *
 * This is the ONLY subtrack-specific thing in src/SubtrackSelector/, and the
 * only reason anything here knows the Subtrack type exists. If the faceted table
 * is ever replaced by a generic upstream selector, everything else in this
 * directory gets deleted and this function SURVIVES.
 *
 * Row order is catalog order, and every consumer depends on that: it is the
 * reference frame for the default lane order. Sorting the table must reorder a
 * derived view, never these rows.
 */
export function toRows(catalog: Subtrack[]): SubtrackRow[] {
  return catalog.map(subtrack => ({
    id: subtrack.label,
    // The id stays the data's value, because that is what the facet keys and
    // the domain names; only what the reader sees is friendly.
    name: subtrack.displayName ?? subtrack.label,
    fields: {
      ...flatten(subtrack.metadata),
    },
  }))
}
