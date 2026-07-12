import { renderToAbstractCanvas, updateStatus } from '@jbrowse/core/util'

import { layoutFeatures } from './layoutFeatures'
import { makeImageData } from './makeImageData'
import { fetchPeptideData } from './peptideUtils'
import { createRenderConfigContext } from './renderConfig'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { RenderArgsDeserialized } from '@jbrowse/core/pluggableElementTypes/renderers/BoxRendererType'
import type { Feature } from '@jbrowse/core/util'
import type { RenderSubtrackArgs } from './subtrackUtils'
import type { SubtrackLayout } from './types'
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
}: {
  pluginManager: PluginManager
  layout: SubtrackLayout
  features: Map<string, Feature>
  renderProps: RenderArgsDeserialized
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

  // Which subtracks to draw, and in what order, is the display's decision -- it
  // travels down through renderProps, like subtrackLaneHeights below. We pass the
  // RAW selection (undefined when there is no display) and let
  // createRenderConfigContext resolve it against the config catalog, so the
  // fallback is applied in exactly one place. It resolves via the same
  // resolveRenderSubtracks the clearing loop in SubtrackFeatureRenderer.render()
  // uses, so the set we clear cannot drift from the set we lay out.
  const { subtracks: subtracksOverride } = renderProps as RenderSubtrackArgs

  // Create config context ONCE at the start - this reads all config values upfront
  // to avoid expensive readConfObject calls in per-feature hot paths
  const configContext = createRenderConfigContext(config, subtracksOverride)

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

  // How tall this block's content actually needs each lane to be.
  //
  // This MUST be derived from the rectangles laid out for THIS block, not from
  // sublayout.getTotalHeight(). GranularRectLayout keeps pTotalHeight as a
  // monotonic high-water mark (`pTotalHeight = max(pTotalHeight, top + height)`)
  // and discardRange() never lowers it -- and the layout is only rebuilt when
  // bpPerPx changes. So across a pan the sublayout total reflects every region
  // ever laid out at this zoom, and can only grow. Reading it here is what made
  // lanes expand when panning into dense sequence and then refuse to shrink on
  // the way back.
  //
  // Measuring our own records keeps the reported height a pure function of this
  // block's features, which is the property the display's convergence relies on.
  const subtrackContentHeights: Record<string, number> = {}

  if (subtrackConfig.enabled) {
    for (const subtrack of subtracks) {
      if (subtrack.visible === false) {
        continue
      }
      subtrackContentHeights[subtrack.label] = 0
    }
    for (const rec of layoutRecords) {
      const label = rec.subtrackLabel
      if (label === undefined || !(label in subtrackContentHeights)) {
        continue
      }
      const h = rec.layout?.totalLayoutHeight || rec.layout?.height || 0
      const bottom = (rec.topPx || 0) + h
      if (Number.isFinite(bottom)) {
        subtrackContentHeights[label] = Math.max(
          subtrackContentHeights[label] ?? 0,
          bottom,
        )
      }
    }
  }

  // Lane geometry is owned by the display and handed to us via renderProps, so
  // that EVERY block in the visible region draws its lanes at identical
  // offsets. Deriving it here per-block cannot work: blocks render in sequence
  // against a shared accumulating layout, so each one would see a different
  // set of features and pick different offsets, and the blocks that already
  // rendered would never be told. The display collects the per-block content
  // heights below, takes the max, and pushes the result back through
  // renderProps -- which re-renders the whole visible region at once.
  const laneHeights = (renderProps as any).subtrackLaneHeights as
    | Record<string, number>
    | undefined

  if (subtrackConfig.enabled) {
    let currentY = 0
    for (const subtrack of subtracks) {
      if (subtrack.visible === false) {
        continue
      }

      // Fall back to this block's own content only on the very first pass,
      // before the display has published any geometry.
      const authoritative = laneHeights?.[subtrack.label]
      const fallback = subtrackContentHeights[subtrack.label] || 0
      const height = Math.max(
        authoritative ?? fallback ?? 0,
        subtrackConfig.minSubtrackHeight,
      )

      subtrackPositions.set(subtrack.label, {
        label: subtrack.label,
        yOffset: currentY,
        height,
        visible: true,
      })

      currentY += height + subtrackConfig.spacing
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
          // downstream renderArgs are typed against a plain BaseLayout; ours is
          // the MultiLayout, which they only read opaquely
          layout: layout as unknown as BaseLayout<unknown>,
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
      // reported back to the display so it can compute the max across blocks
      subtrackContentHeights,
    }
  })
}
