import type { Feature } from '@jbrowse/core/util'

/** The attribute name the display's `groupBy` partitions on. */
export const SUBTRACK_ATTR = 'subtrack'

/**
 * A feature that also answers `get('subtrack')`. Delegation rather than a
 * rebuilt SimpleFeature: rebuilding drops subfeatures and the parent handle,
 * which the gene glyph path needs.
 */
export function decorateFeature(feature: Feature, lane: string): Feature {
  return {
    ...feature,
    get: (name: string) => (name === SUBTRACK_ATTR ? lane : feature.get(name)),
    id: () => feature.id(),
    parent: () => feature.parent?.(),
    children: () => feature.children?.(),
    toJSON: () => ({ ...feature.toJSON(), [SUBTRACK_ATTR]: lane }),
  } as unknown as Feature
}
