import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

export interface SubtrackRow {
  /** the subtrack label; the lane identity everywhere in this plugin */
  id: string
  name: string
  /** featureFilters merged under metadata, primitives only */
  fields: Record<string, string>
}

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

export function getFacetKeys(rows: SubtrackRow[]): string[] {
  return [...new Set(rows.flatMap(row => Object.keys(row.fields)))].sort()
}

/**
 * Counts per value, per facet, with drill-down semantics copied from JBrowse 2's
 * FacetFilters.tsx: facets that already have an active filter are counted
 * against the row set as it stood BEFORE that filter was applied. Otherwise
 * selecting "P. falciparum" would show every other organism with a count of
 * zero, and the user could never widen the selection again.
 */
export function getFacetCounts(
  rows: SubtrackRow[],
  facetKeys: string[],
  filters: Map<string, string[]>,
): Map<string, Map<string, number>> {
  const counts = new Map(
    facetKeys.map(key => [key, new Map<string, number>()] as const),
  )

  // active facets first, so each is counted before its own filter narrows things
  const ordered = [
    ...facetKeys.filter(key => filters.get(key)?.length),
    ...facetKeys.filter(key => !filters.get(key)?.length),
  ]

  let current = rows
  for (const key of ordered) {
    const counter = counts.get(key)
    if (!counter) {
      continue
    }
    for (const row of current) {
      const value = row.fields[key]
      if (value) {
        counter.set(value, (counter.get(value) ?? 0) + 1)
      }
    }

    const selected = filters.get(key)
    if (selected?.length) {
      const selectedSet = new Set(selected)
      current = current.filter(row => {
        const value = row.fields[key]
        return value !== undefined && selectedSet.has(value)
      })
    }
  }

  return counts
}

/** Rows surviving the text search and every active facet filter. */
export function filterRows(
  rows: SubtrackRow[],
  filterText: string,
  filters: Map<string, string[]>,
): SubtrackRow[] {
  const query = filterText.trim().toLowerCase()

  const active = [...filters.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => [key, new Set(values)] as const)

  return rows.filter(row => {
    if (
      query &&
      !row.name.toLowerCase().includes(query) &&
      !Object.values(row.fields).some(v => v.toLowerCase().includes(query))
    ) {
      return false
    }
    return active.every(([key, values]) => {
      const value = row.fields[key]
      return value !== undefined && values.has(value)
    })
  })
}
