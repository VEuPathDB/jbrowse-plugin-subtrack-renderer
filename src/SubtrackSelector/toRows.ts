import type { SubtrackRow } from './subtrackRows'
import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

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
 * The JBrowse 1 trick, ported: featureFilters do double duty as the
 * lane-assignment predicate AND the facetable columns, so whatever attribute a
 * synteny subtrack filters on is automatically an attribute the selector can
 * facet on. No metadata service, no adapter, no fetch.
 *
 * metadata is spread last so it wins a key collision, matching JBrowse 1's
 * `dojo.mixin(base, featureFilters, metadata)` argument order.
 *
 * This is the ONLY subtrack-specific thing in src/SubtrackSelector/, and the
 * only reason anything here knows the Subtrack type exists. It lives in its own
 * module because it is the adapter: if the faceted table is ever replaced by an
 * upstreamed generic JBrowse 2 FacetedSelector, everything else in this
 * directory gets deleted and this function SURVIVES. Keeping it filed with the
 * code it would outlive is what made the boundary aspirational rather than real.
 *
 * Row order is catalog order, and every consumer depends on that: it is the
 * reference frame for the default lane order. Sorting the table must reorder a
 * derived view, never these rows.
 */
export function toRows(catalog: Subtrack[]): SubtrackRow[] {
  return catalog.map(subtrack => ({
    id: subtrack.label,
    name: subtrack.label,
    fields: {
      ...flatten(subtrack.featureFilters),
      ...flatten(subtrack.metadata),
    },
  }))
}
