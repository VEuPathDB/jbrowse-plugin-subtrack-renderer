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
  subtrackHeightCache,
}: {
  pluginManager: PluginManager
  layout: BaseLayout<unknown>
  features: Map<string, Feature>
  renderProps: RenderArgsDeserialized
  subtrackHeightCache: Map<string, Map<string, number>>
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
        subtrackHeightCache,
      })
    },
  )

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

    console.log('[SubtrackRenderer] Final track height (subtracks enabled):', {
      height,
      totalHeight,
      subtracks: Array.from(subtrackPositions.entries()).map(([label, info]) => ({
        label,
        yOffset: info.yOffset,
        height: info.height,
      })),
    })
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
    console.log('[SubtrackRenderer] Final track height (subtracks disabled):', {
      height,
      maxHeight,
    })
  }

  // Ensure height is a valid positive integer
  height = Math.max(1, Math.round(height))
  if (!Number.isFinite(height)) {
    console.error('[SubtrackRenderer] Invalid height calculated, using fallback:', height)
    height = 100
  }

  const peptideDataMap = await updateStatus(
    'Fetching peptide data',
    statusCallback,
    async () => {
      return fetchPeptideData(pluginManager, renderProps, features)
    },
  )

  console.log('[SubtrackRenderer] About to render with dimensions:', { width, height, layoutRecords: layoutRecords.length })

  return updateStatus('Rendering features', statusCallback, async () => {
    const result = await renderToAbstractCanvas(width, height, renderProps, ctx => {
      console.log('[SubtrackRenderer] Canvas context received:', {
        canvasWidth: ctx.canvas.width,
        canvasHeight: ctx.canvas.height,
        fillStyle: ctx.fillStyle,
      })

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

    console.log('[SubtrackRenderer] renderToAbstractCanvas returned:', {
      hasImageData: !!result.imageData,
      imageDataType: result.imageData?.constructor?.name,
      width: result.width,
      height: result.height,
    })

    // CRITICAL: renderToAbstractCanvas doesn't return width/height, add them back
    return {
      ...result,
      width,
      height,
    }
  })
}
