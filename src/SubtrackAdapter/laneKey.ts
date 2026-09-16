import { matchesFilters } from './featureFilters'

import type { FeatureFilters } from './featureFilters'

/**
 * One lane. `label` is the lane's identity: it is the value stamped onto each
 * feature, the key `hiddenGroupKeys` hides by, and the row id in the selector.
 * `metadata` is what the selector facets on; nothing in rendering reads it.
 */
export interface Lane {
  label: string
  featureFilters: FeatureFilters
  metadata?: Record<string, string>
  visible?: boolean
}

interface FeatureLike {
  get: (name: string) => unknown
}

/**
 * The lane a feature belongs to, or undefined for none — which leaves the
 * feature unstamped, and so in the `''` catch-all section downstream.
 * First match wins: lane order is filter precedence.
 */
export function laneKeyFor(
  feature: FeatureLike,
  lanes: readonly Lane[],
): string | undefined {
  return lanes.find(lane => matchesFilters(feature, lane.featureFilters))?.label
}
