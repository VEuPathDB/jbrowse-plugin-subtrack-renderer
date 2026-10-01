import type { Lane as Subtrack } from './subtrackCatalog'

// resolveSubtracks runs inside a MobX computed that recomputes on every config
// change, and the caller hands us a freshly cloned array each time (getConf ->
// readConfObject structuredClones it) -- so this has to be keyed on content, not
// on array identity, or it warns forever.
const warnedSignatures = new Set<string>()

/** test-only: the throttle above is module state and outlives a single test */
export function resetDuplicateWarnings(): void {
  warnedSignatures.clear()
}

/**
 * The label is the lane's identity: laneHeights is keyed by it, buildLayoutKey()
 * composes it into the layout key, and the selector uses it as the row id and
 * the selection token. A duplicate silently corrupts lane geometry, so drop it
 * loudly rather than quietly -- but only once per distinct set of offending
 * labels, since this runs on every recompute.
 */
export function dedupeCatalog(catalog: Subtrack[]): Subtrack[] {
  const seen = new Set<string>()
  const out: Subtrack[] = []
  const duplicates = new Set<string>()

  for (const subtrack of catalog) {
    if (seen.has(subtrack.label)) {
      duplicates.add(subtrack.label)
      continue
    }
    seen.add(subtrack.label)
    out.push(subtrack)
  }

  if (duplicates.size) {
    const labels = [...duplicates]
    const signature = labels.join('\0')
    if (!warnedSignatures.has(signature)) {
      warnedSignatures.add(signature)
      console.warn(
        `[SubtrackRenderer] ignoring duplicate subtrack labels: ${labels.join(', ')}. ` +
          'Labels identify lanes, so duplicates corrupt lane geometry.',
      )
    }
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
