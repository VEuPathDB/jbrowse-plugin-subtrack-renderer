import { renderToAbstractCanvas, updateStatus } from '@jbrowse/core/util'

import { layoutFeatures } from './layoutFeatures'
import { makeImageData } from './makeImageData'
import { fetchPeptideData } from './peptideUtils'
import { createRenderConfigContext } from './renderConfig'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { RenderArgsDeserialized } from '@jbrowse/core/pluggableElementTypes/renderers/BoxRendererType'
import type { Feature } from '@jbrowse/core/util'
import type { BaseLayout } from '@jbrowse/core/util/layouts'

/**
 * Main rendering pipeline for CanvasFeatureRenderer
 *
 * IMPORTANT: Config values are read ONCE at the start via createRenderConfigContext()
 * and passed through the entire pipeline. This is critical for performance since
 * readConfObject() is expensive (JEXL evaluation, MobX reactions, tree traversal).
 *
 * DO NOT call readConfObject() in hot paths (per-feature loops). If you need a new
 * config value, add it to RenderConfigContext and createRenderConfigContext().
 */
export async function doAll({
  layout,
  features,
  renderProps,
  pluginManager,
  heightStats,
}: {
  pluginManager: PluginManager
  layout: BaseLayout<unknown>
  features: Map<string, Feature>
  renderProps: RenderArgsDeserialized
  heightStats: Map<string, Map<string, {min: number, max: number}>>
}) {
  const { statusCallback = () => {}, regions, bpPerPx, config } = renderProps
  const region = regions[0]!
  let width = (region.end - region.start) / bpPerPx

  // Ensure width is a valid positive integer
  width = Math.max(1, Math.round(width))
  if (!Number.isFinite(width)) {
    console.error('[SubtrackRenderer] Invalid width calculated, using fallback:', width)
    width = 800
  }

  // Create config context ONCE at the start - this reads all config values upfront
  // to avoid expensive readConfObject calls in per-feature hot paths
  const configContext = createRenderConfigContext(config)

  // Get subtrack configuration from context
  const { subtracks, subtrackConfig } = configContext

  const { layoutRecords, subtrackPositions } = await updateStatus(
    'Computing feature layout',
    statusCallback,
    async () => {
      return layoutFeatures({
        features,
        bpPerPx,
        region,
        configContext,
        layout,
        pluginManager,
        subtracks,
        subtrackConfig,
      })
    },
  )

  // Calculate yOffsets using MAX heights seen across all renders
  // This keeps yOffsets stable even as different regions are rendered
  if (subtrackConfig.enabled && 'subLayouts' in layout) {
    // Get or create stats for this refName
    let refStats = heightStats.get(region.refName)
    if (!refStats) {
      refStats = new Map()
      heightStats.set(region.refName, refStats)
    }

    // First pass: Update min/max stats with current heights
    for (const subtrack of subtracks) {
      if (subtrack.visible === false) continue

      const layoutKey = `${region.refName}:${subtrack.label}`
      const sublayout = (layout as any).subLayouts?.get(layoutKey)

      if (sublayout && typeof sublayout.getTotalHeight === 'function') {
        const currentHeight = sublayout.getTotalHeight()
        if (Number.isFinite(currentHeight) && currentHeight > 0) {
          let stats = refStats.get(subtrack.label)
          if (!stats) {
            stats = { min: currentHeight, max: currentHeight }
            refStats.set(subtrack.label, stats)
          } else {
            stats.min = Math.min(stats.min, currentHeight)
            stats.max = Math.max(stats.max, currentHeight)
          }
        }
      }
    }

    // Second pass: Calculate yOffsets using MAX heights for consistency
    let currentY = 0
    for (const subtrack of subtracks) {
      if (subtrack.visible === false) continue

      const stats = refStats.get(subtrack.label)
      // Use MAX height to ensure enough space for tallest regions
      const heightToUse = stats
        ? Math.max(stats.max, subtrackConfig.perSubtrackHeight)
        : subtrackConfig.perSubtrackHeight

      subtrackPositions.set(subtrack.label, {
        label: subtrack.label,
        yOffset: currentY,
        height: heightToUse,
        visible: true,
      })

      currentY += heightToUse + subtrackConfig.spacing
    }
  }

  // Calculate height differently when subtracks are enabled
  let height: number
  if (subtrackConfig.enabled && subtrackPositions.size > 0) {
    // Sum of all visible subtrack heights
    const totalHeight = Array.from(subtrackPositions.values()).reduce(
      (sum, info) => sum + info.height + subtrackConfig.spacing,
      0,
    )
    // Remove last spacing
    height = totalHeight - subtrackConfig.spacing
  } else {
    // MultiLayout doesn't have getTotalHeight - calculate from sublayouts
    let maxHeight = 0
    if ('getSublayout' in layout && (layout as any).subLayouts) {
      for (const [, sublayout] of (layout as any).subLayouts) {
        if (sublayout && typeof sublayout.getTotalHeight === 'function') {
          const sublayoutHeight = sublayout.getTotalHeight()
          // Validate height - can be NaN if sublayout is empty
          if (Number.isFinite(sublayoutHeight) && sublayoutHeight > 0) {
            maxHeight = Math.max(maxHeight, sublayoutHeight)
          }
        }
      }
    }
    height = maxHeight || 100
  }

  // Ensure height is a valid positive integer
  height = Math.max(1, Math.round(height))
  if (!Number.isFinite(height)) {
    height = 100
  }

  const peptideDataMap = await updateStatus(
    'Fetching peptide data',
    statusCallback,
    async () => {
      return fetchPeptideData(pluginManager, renderProps, features)
    },
  )

  return updateStatus('Rendering features', statusCallback, async () => {
    const result = await renderToAbstractCanvas(width, height, renderProps, ctx => {
      return makeImageData({
        ctx,
        layoutRecords,
        canvasWidth: width,
        renderArgs: {
          ...renderProps,
          features,
          layout,
          displayMode: configContext.displayMode,
          peptideDataMap,
          colorByCDS: (renderProps as any).colorByCDS,
          pluginManager,
        },
        configContext,
        subtrackPositions,
        subtrackConfig,
      })
    })

    // CRITICAL: renderToAbstractCanvas doesn't return width/height, add them back
    return {
      ...result,
      width,
      height,
    }
  })
}
