/**
 * Generic faceted-table primitives. Nothing in this file knows what a subtrack
 * is -- rows arrive already flattened (see ./toRows, the one adapter that does).
 * That is deliberate: it is what would let this whole file be deleted in favour
 * of an upstreamed generic JBrowse 2 FacetedSelector, rather than rewritten.
 */

export interface SubtrackRow {
  /** the subtrack label; the lane identity everywhere in this plugin */
  id: string
  name: string
  /** featureFilters merged under metadata, primitives only */
  fields: Record<string, string>
}

export function getFacetKeys(rows: SubtrackRow[]): string[] {
  return [...new Set(rows.flatMap(row => Object.keys(row.fields)))].sort()
}

/**
 * Counts per value, per facet, with drill-down semantics: each facet is counted
 * against the rows surviving every OTHER active filter, but not its own.
 * Otherwise selecting "P. falciparum" would show every other organism with a
 * count of zero, and the user could never widen the selection again.
 *
 * WE DIVERGE FROM JBROWSE 2's FacetFilters.tsx ON PURPOSE HERE. Upstream walks
 * the facets in sequence, narrowing an accumulator as it goes, so facet `Ai` is
 * counted against the filters of `A1..A(i-1)` only -- it never sees the filters
 * of the facets AFTER it. With two or more active facets that means only the
 * last one gets correct counts, and which facet that is falls out of the
 * alphabetical sort of the keys. Concretely: with organism=[P. falciparum] and
 * study=[Ref] both active, the organism facet advertises "P. vivax (2)" while
 * clicking it actually yields 1 row. Sibling counts are exactly what the user
 * steers by, so a lying count is worse than no count.
 *
 * The version below is order-independent: it re-derives the visible row set per
 * facet rather than accumulating. Do not "restore fidelity" with upstream here.
 */
export function getFacetCounts(
  rows: SubtrackRow[],
  facetKeys: string[],
  filters: Map<string, string[]>,
): Map<string, Map<string, number>> {
  const active = [...filters.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => [key, new Set(values)] as const)

  return new Map(
    facetKeys.map(key => {
      const counter = new Map<string, number>()
      for (const row of rows) {
        const visible = active.every(([k, values]) => {
          if (k === key) {
            return true
          }
          const v = row.fields[k]
          return v !== undefined && values.has(v)
        })
        // note `!== undefined`, not a truthy check: an empty-string field value
        // is filterable, so it must be countable too
        const value = row.fields[key]
        if (visible && value !== undefined) {
          counter.set(value, (counter.get(value) ?? 0) + 1)
        }
      }
      return [key, counter] as const
    }),
  )
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
