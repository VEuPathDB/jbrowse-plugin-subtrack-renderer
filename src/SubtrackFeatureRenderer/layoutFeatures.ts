import { readConfObject } from '@jbrowse/core/configuration'

import { createFeatureFloatingLabels } from './floatingLabels'
import { layoutFeature } from './layoutFeature'
import {
  buildLayoutKey,
  calculateSubtrackPositions,
  getFeatureSubtrack,
  type Subtrack,
  type SubtrackConfig,
  type SubtrackInfo,
} from './subtrackUtils'

import type { RenderConfigContext } from './renderConfig'
import type { LayoutRecord } from './types'
import type PluginManager from '@jbrowse/core/PluginManager'
import type { Feature, Region } from '@jbrowse/core/util'
import type { BaseLayout } from '@jbrowse/core/util/layouts'

const yPadding = 5

export function layoutFeatures({
  features,
  bpPerPx,
  region,
  configContext,
  layout,
  pluginManager,
  subtracks = [],
  subtrackConfig = {
    enabled: false,
    perSubtrackHeight: 100,
    minSubtrackHeight: 20,
    spacing: 5,
    showLabels: true,
  },
  subtrackHeightCache,
}: {
  features: Map<string, Feature>
  bpPerPx: number
  region: Region
  configContext: RenderConfigContext
  layout: BaseLayout<unknown>
  pluginManager: PluginManager
  subtracks?: Subtrack[]
  subtrackConfig?: SubtrackConfig
  subtrackHeightCache?: Map<string, Map<string, number>>
}): {
  layoutRecords: LayoutRecord[]
  subtrackPositions: Map<string, SubtrackInfo>
} {
  const reversed = region.reversed || false
  const layoutRecords: LayoutRecord[] = []
  const { config } = configContext

  // Calculate subtrack positions if enabled
  const subtrackPositions = subtrackConfig.enabled
    ? calculateSubtrackPositions(subtracks, subtrackConfig)
    : new Map<string, SubtrackInfo>()

  // Debug logging
  console.log('[SubtrackRenderer] Layout phase:', {
    totalFeatures: features.size,
    subtracksEnabled: subtrackConfig.enabled,
    subtracksConfigured: subtracks.length,
    visibleSubtracks: subtracks.filter(s => s.visible).map(s => s.label),
  })

  let filteredCount = 0
  let matchedCount = 0
  let debugLabeledFeatureCount = 0
  let debugFeatureCount = 0

  // Get or create cache for this refName
  let refNameCache: Map<string, number> | undefined
  if (subtrackHeightCache) {
    refNameCache = subtrackHeightCache.get(region.refName)
    if (!refNameCache) {
      refNameCache = new Map()
      subtrackHeightCache.set(region.refName, refNameCache)
    }
  }

  // Layout features into sublayouts (all starting at Y=0, will overlap)
  // yOffsets will be applied later during rendering
  for (const feature of features.values()) {
    // Debug: Log first few features early to see all processing
    debugFeatureCount++
    if (debugFeatureCount <= 5) {
      const rawName = readConfObject(config, ['labels', 'name'], { feature })
      const rawDescription = readConfObject(config, ['labels', 'description'], { feature })
      console.log('[SubtrackRenderer] Early feature inspection:', {
        count: debugFeatureCount,
        featureId: feature.id(),
        featureType: feature.get('type'),
        rawName,
        rawDescription,
        nameType: typeof rawName,
        descriptionType: typeof rawDescription,
      })
    }

    // If subtracks are enabled, filter features
    let subtrack: Subtrack | null = null
    let subtrackInfo: SubtrackInfo | undefined

    if (subtrackConfig.enabled) {
      subtrack = getFeatureSubtrack(feature, subtracks)
      if (!subtrack) {
        // Feature doesn't match any visible subtrack - skip it
        filteredCount++
        continue
      }
      matchedCount++

      subtrackInfo = subtrackPositions.get(subtrack.label)
      if (!subtrackInfo) {
        continue
      }
    }
    const featureLayout = layoutFeature({
      feature,
      bpPerPx,
      reversed,
      configContext,
      pluginManager,
    })

    const totalLayoutWidth = featureLayout.totalLayoutWidth
    const totalLayoutHeight = featureLayout.totalLayoutHeight

    // Debug: check for NaN height
    if (!Number.isFinite(totalLayoutHeight)) {
      console.error('[SubtrackRenderer] Invalid totalLayoutHeight from layoutFeature:', {
        totalLayoutHeight,
        featureId: feature.id(),
        featureLayout,
      })
    }

    const rawName = readConfObject(config, ['labels', 'name'], { feature })
    const rawDescription = readConfObject(config, ['labels', 'description'], { feature })

    const name = String(rawName || '')
    const description = String(rawDescription || '')

    // Create floating labels for features
    const floatingLabels = createFeatureFloatingLabels({
      feature,
      config,
      configContext,
      nameColor: 'black',
      descriptionColor: 'blue',
      name,
      description,
    })

    // Debug: Log processed features with labels
    if (debugFeatureCount <= 5) {
      console.log('[SubtrackRenderer] Feature after label creation:', {
        featureId: feature.id(),
        featureType: feature.get('type'),
        name,
        description,
        floatingLabelsCount: floatingLabels.length,
      })
    }

    const featureStart = feature.get('start')
    const featureEnd = feature.get('end')
    const leftPaddingBp = featureLayout.leftPadding * bpPerPx
    const rightPaddingBp =
      (totalLayoutWidth - featureLayout.width - featureLayout.leftPadding) *
      bpPerPx
    const layoutStart = featureStart - leftPaddingBp
    const layoutEnd = featureEnd + rightPaddingBp

    // Validate coordinates - NaN causes SVG rendering errors
    if (!Number.isFinite(layoutStart) || !Number.isFinite(layoutEnd)) {
      console.error('[SubtrackRenderer] Invalid layout coordinates:', {
        featureId: feature.id(),
        featureStart,
        featureEnd,
        leftPaddingBp,
        rightPaddingBp,
        layoutStart,
        layoutEnd,
        featureLayout,
      })
      continue // Skip this feature
    }

    // Build layout key - use composite key if subtracks enabled
    const layoutKey = subtrack
      ? buildLayoutKey(region.refName, subtrack.label)
      : feature.id()

    // Calculate the total height needed including floating labels
    let floatingLabelsHeight = 0
    if (floatingLabels.length > 0) {
      // Find the maximum relativeY + font height + padding for descenders
      const maxRelativeY = Math.max(...floatingLabels.map(l => l.relativeY))
      floatingLabelsHeight = maxRelativeY + 15 // 11px font height + 4px descenders/padding

      // Debug: Log first few features with labels
      if (debugLabeledFeatureCount <= 2) {
        console.log('[SubtrackRenderer] Floating labels height calculation:', {
          featureId: feature.id(),
          numLabels: floatingLabels.length,
          labelDetails: floatingLabels.map(l => ({ text: l.text, relativeY: l.relativeY })),
          maxRelativeY,
          floatingLabelsHeight,
          totalLayoutHeight,
          yPadding,
          totalRectHeight: totalLayoutHeight + yPadding + floatingLabelsHeight,
        })
      }
    }

    // Ensure height is valid - use fallback if NaN
    let rectHeight = totalLayoutHeight + yPadding + floatingLabelsHeight
    if (!Number.isFinite(rectHeight)) {
      console.error('[SubtrackRenderer] NaN rectHeight before addRect:', {
        totalLayoutHeight,
        yPadding,
        floatingLabelsHeight,
        featureId: feature.id(),
        featureType: feature.get('type'),
        featureStart,
        featureEnd,
        layoutStart,
        layoutEnd,
      })
      rectHeight = 15 // Default height with padding
    }

    const topPx = layout.addRect(
      layoutKey,      // layoutName (for MultiLayout) or id (for GranularRectLayout)
      feature.id(),   // id (only used by MultiLayout)
      layoutStart,    // left
      layoutEnd,      // right
      rectHeight,     // height
      feature,        // data
      {
        label: name,
        description,
        refName: feature.get('refName'),
        floatingLabels,
        totalFeatureHeight: featureLayout.height,
        totalLayoutWidth,
        featureWidth: featureLayout.width,
        leftPadding: featureLayout.leftPadding,
      },
    )

    if (topPx !== null) {
      // Store position WITHOUT yOffset - we'll apply it during rendering
      layoutRecords.push({
        feature,
        layout: featureLayout,
        topPx, // Sublayout-relative position (starts at 0)
        label: name,
        description,
        subtrackLabel: subtrack?.label,
        floatingLabels,
      })
    }
  }

  // After all features are laid out, calculate yOffsets based on sublayout heights
  if (subtrackConfig.enabled) {
    let currentY = 0
    for (const subtrack of subtracks) {
      if (!subtrack.visible) {
        continue
      }

      const layoutKey = buildLayoutKey(region.refName, subtrack.label)

      // Query actual height from the persistent sublayout
      let actualHeight = 0
      if ('getSublayout' in layout) {
        try {
          const sublayout = (layout as any).getSublayout(layoutKey)
          if (sublayout && typeof sublayout.getTotalHeight === 'function') {
            const sublayoutHeight = sublayout.getTotalHeight()
            // getTotalHeight() returns NaN for an empty sublayout
            if (Number.isFinite(sublayoutHeight) && sublayoutHeight > 0) {
              actualHeight = sublayoutHeight
            }
          }
        } catch (e) {
          console.warn('[SubtrackRenderer] Failed to query sublayout height:', e)
        }
      }

      // Lanes size to their content; perSubtrackHeight is only the fallback for
      // when the layout has not reported a height yet. See doAll.ts.
      const height = actualHeight
        ? Math.max(actualHeight, subtrackConfig.minSubtrackHeight)
        : subtrackConfig.perSubtrackHeight

      subtrackPositions.set(subtrack.label, {
        label: subtrack.label,
        yOffset: currentY,
        height,
        visible: true,
      })

      currentY += height + subtrackConfig.spacing
    }
  }

  return { layoutRecords, subtrackPositions }
}
