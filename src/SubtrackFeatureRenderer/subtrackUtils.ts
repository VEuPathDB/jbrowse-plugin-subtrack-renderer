import type { Feature } from '@jbrowse/core/util'

export interface Subtrack {
  label: string
  featureFilters: Record<string, any>
  metadata?: Record<string, string>
  visible: boolean
}

export interface SubtrackConfig {
  enabled: boolean
  /** fallback height, used only until the layout reports its content height */
  perSubtrackHeight: number
  /** floor a lane may shrink to, so its label stays legible */
  minSubtrackHeight: number
  spacing: number
  showLabels: boolean
}

export interface SubtrackInfo {
  label: string
  yOffset: number
  height: number
  visible: boolean
}

/**
 * Test if a feature matches a subtrack's filter criteria
 * Returns true if ALL filter criteria match
 */
function featureMatchesSubtrack(
  feature: Feature,
  subtrack: Subtrack,
): boolean {
  for (const [key, value] of Object.entries(subtrack.featureFilters)) {
    const featureValue = feature.get(key)

    // Handle range filters like { min: 10, max: 50 }
    if (
      typeof value === 'object' &&
      value !== null &&
      'min' in value &&
      'max' in value
    ) {
      if (
        typeof featureValue !== 'number' ||
        featureValue < value.min ||
        featureValue >= value.max
      ) {
        return false
      }
    }
    // Handle array values (OR logic within a filter)
    else if (Array.isArray(value)) {
      if (!value.includes(featureValue)) {
        return false
      }
    }
    // Handle single value
    else if (featureValue !== value) {
      return false
    }
  }
  return true
}

/**
 * Find which subtrack a feature belongs to
 * Returns the first matching visible subtrack, or null
 */
export function getFeatureSubtrack(
  feature: Feature,
  subtracks: Subtrack[],
): Subtrack | null {
  for (const subtrack of subtracks) {
    // Treat undefined as visible (consistent with SubtrackFeatureRenderer)
    if (subtrack.visible === false) {
      continue
    }
    if (featureMatchesSubtrack(feature, subtrack)) {
      return subtrack
    }
  }
  return null
}

/**
 * Calculate vertical positioning for visible subtracks
 */
export function calculateSubtrackPositions(
  subtracks: Subtrack[],
  config: SubtrackConfig,
): Map<string, SubtrackInfo> {
  const positions = new Map<string, SubtrackInfo>()
  let currentY = 0

  for (const subtrack of subtracks) {
    // Treat undefined as visible (consistent with SubtrackFeatureRenderer)
    if (subtrack.visible === false) {
      continue
    }

    positions.set(subtrack.label, {
      label: subtrack.label,
      yOffset: currentY,
      height: config.perSubtrackHeight,
      visible: true,
    })

    currentY += config.perSubtrackHeight + config.spacing
  }

  return positions
}

/**
 * Build composite layout key for MultiLayout
 */
export function buildLayoutKey(refName: string, subtrackLabel: string): string {
  return `${refName}:${subtrackLabel}`
}
