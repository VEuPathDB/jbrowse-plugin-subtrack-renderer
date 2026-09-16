/** A lane's filter set: every entry must match for the feature to belong. */
export type FeatureFilters = Record<string, unknown>

interface RangeFilter {
  min: number
  max: number
}

function isRangeFilter(v: unknown): v is RangeFilter {
  return (
    typeof v === 'object' &&
    v !== null &&
    'min' in v &&
    'max' in v &&
    typeof (v as RangeFilter).min === 'number' &&
    typeof (v as RangeFilter).max === 'number'
  )
}

interface FeatureLike {
  get: (name: string) => unknown
}

export function matchesFilters(
  feature: FeatureLike,
  filters: FeatureFilters,
): boolean {
  for (const [key, want] of Object.entries(filters)) {
    const got = feature.get(key)
    if (isRangeFilter(want)) {
      if (typeof got !== 'number' || got < want.min || got >= want.max) {
        return false
      }
    } else if (got === undefined || String(got) !== String(want)) {
      return false
    }
  }
  return true
}
