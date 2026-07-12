import { builtinGlyphs, findGlyph } from './glyphs'
import { applyLabelDimensions } from './labelUtils'

import type { RenderConfigContext } from './renderConfig'
import type { FeatureLayout, LayoutArgs } from './types'
import type PluginManager from '@jbrowse/core/PluginManager'
import type { Feature } from '@jbrowse/core/util'
import type GlyphType from '@jbrowse/core/pluggableElementTypes/GlyphType'

// Uses core's GlyphType rather than a second hand-rolled mirror -- see the note
// in drawFeature.ts. Keeping a local copy here is how the two drifted apart from
// core in the first place.

// Re-export for backwards compatibility
export { applyLabelDimensions } from './labelUtils'

/**
 * Find a matching pluggable glyph from the plugin manager.
 * Pluggable glyphs take priority over builtin glyphs.
 */
function findPluggableGlyph(
  feature: Feature,
  pluginManager?: PluginManager,
): GlyphType | undefined {
  if (!pluginManager) {
    return undefined
  }
  const glyphTypes = (pluginManager as any).getGlyphTypes?.() || []
  const sortedGlyphs = [...glyphTypes].sort((a: GlyphType, b: GlyphType) => b.priority - a.priority)
  return sortedGlyphs.find((glyph: GlyphType) => glyph.match?.(feature))
}

/**
 * Layout a feature using the polymorphic glyph system.
 *
 * Phase 1 of the two-phase rendering:
 * 1. Find the matching glyph for the feature
 * 2. Call the glyph's layout function to allocate its rectangle
 * 3. Apply label dimensions
 */
export function layoutFeature(args: {
  feature: Feature
  bpPerPx: number
  reversed: boolean
  configContext: RenderConfigContext
  pluginManager?: PluginManager
  isNested?: boolean
  isTranscriptChild?: boolean
}): FeatureLayout {
  const {
    feature,
    bpPerPx,
    reversed,
    configContext,
    pluginManager,
    isNested = false,
    isTranscriptChild = false,
  } = args

  // Check for pluggable glyph first (higher priority)
  const pluggableGlyph = findPluggableGlyph(feature, pluginManager)

  let layout: FeatureLayout

  if (pluggableGlyph) {
    // Use pluggable glyph's layout (legacy interface)
    // TODO: Migrate pluggable glyphs to new Glyph interface
    const heightMultiplier =
      pluggableGlyph.getHeightMultiplier?.(feature, configContext.config) ?? 1
    const baseGlyph = findGlyph(feature, configContext, builtinGlyphs)

    const layoutArgs: LayoutArgs = {
      feature,
      bpPerPx,
      reversed,
      configContext,
      pluginManager,
    }

    layout = baseGlyph.layout(layoutArgs)

    // Apply height multiplier from pluggable glyph
    layout.height *= heightMultiplier
    layout.totalLayoutHeight *= heightMultiplier
  } else {
    // Use builtin polymorphic glyph
    const glyph = findGlyph(feature, configContext, builtinGlyphs)

    const layoutArgs: LayoutArgs = {
      feature,
      bpPerPx,
      reversed,
      configContext,
      pluginManager,
    }

    layout = glyph.layout(layoutArgs)
  }

  // Debug: check layout from glyph
  if (!Number.isFinite(layout.height) || !Number.isFinite(layout.totalLayoutHeight)) {
    console.error('[SubtrackRenderer] Invalid layout from glyph:', {
      featureId: feature.id(),
      featureType: feature.get('type'),
      height: layout.height,
      totalLayoutHeight: layout.totalLayoutHeight,
      layout,
    })
  }

  // Apply label dimensions
  applyLabelDimensions(layout, {
    feature,
    configContext,
    isNested,
    isTranscriptChild,
  })

  return layout
}
