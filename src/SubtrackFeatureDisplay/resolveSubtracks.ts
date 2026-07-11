import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

/**
 * The label is the lane's identity: laneHeights is keyed by it, buildLayoutKey()
 * composes it into the layout key, and the selector uses it as the row id and
 * the selection token. A duplicate silently corrupts lane geometry, so drop it
 * loudly rather than quietly.
 */
export function dedupeCatalog(catalog: Subtrack[]): Subtrack[] {
  const seen = new Set<string>()
  const out: Subtrack[] = []
  const duplicates: string[] = []

  for (const subtrack of catalog) {
    if (seen.has(subtrack.label)) {
      duplicates.push(subtrack.label)
      continue
    }
    seen.add(subtrack.label)
    out.push(subtrack)
  }

  if (duplicates.length) {
    console.warn(
      `[SubtrackRenderer] ignoring duplicate subtrack labels: ${duplicates.join(', ')}. ` +
        'Labels identify lanes, so duplicates corrupt lane geometry.',
    )
  }

  return out
}

/**
 * Turn the config catalog plus the user's selection into the ordered list of
 * lanes to draw.
 *
 * `selection` undefined means the user has not chosen yet, so fall back to the
 * catalog's own defaults. Labels absent from the catalog are dropped, which is
 * how a config that retires a subtrack degrades a stale session gracefully
 * instead of crashing it.
 */
export function resolveSubtracks(
  catalog: Subtrack[],
  selection: string[] | undefined,
): Subtrack[] {
  const deduped = dedupeCatalog(catalog)

  if (!selection) {
    return deduped.filter(s => s.visible !== false)
  }

  const byLabel = new Map(deduped.map(s => [s.label, s]))
  const used = new Set<string>()
  const out: Subtrack[] = []

  for (const label of selection) {
    const subtrack = byLabel.get(label)
    if (subtrack && !used.has(label)) {
      used.add(label)
      // an explicit selection overrides the catalog's default-off flag
      out.push({ ...subtrack, visible: true })
    }
  }

  return out
}
