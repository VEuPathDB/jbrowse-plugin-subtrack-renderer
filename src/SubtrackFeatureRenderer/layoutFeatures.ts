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
  subtrackHeightCache: Map<string, Map<string, number>>
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

  // Get or create cache for this refName
  let refNameCache = subtrackHeightCache.get(region.refName)
  if (!refNameCache) {
    refNameCache = new Map()
    subtrackHeightCache.set(region.refName, refNameCache)
  }

  // Layout features into sublayouts (all starting at Y=0, will overlap)
  // yOffsets will be applied later during rendering
  for (const feature of features.values()) {
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

    const name = String(
      readConfObject(config, ['labels', 'name'], { feature }) || '',
    )
    const description = String(
      readConfObject(config, ['labels', 'description'], { feature }) || '',
    )

    // TEMPORARY: Disable floating labels to isolate SVG error
    const floatingLabels: any[] = []
    // const floatingLabels = createFeatureFloatingLabels({
    //   feature,
    //   config,
    //   configContext,
    //   nameColor: 'black',
    //   descriptionColor: 'blue',
    //   name,
    //   description,
    // })

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

    // Ensure height is valid - use fallback if NaN
    let rectHeight = totalLayoutHeight + yPadding
    if (!Number.isFinite(rectHeight)) {
      console.error('[SubtrackRenderer] NaN rectHeight before addRect:', {
        totalLayoutHeight,
        yPadding,
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

      console.log("LAYOUTKEY=" + layoutKey)
      console.log("Layout type:", layout.constructor.name)
      console.log("Layout subLayoutConstructorArgs:", (layout as any).subLayoutConstructorArgs)

      // Query actual height from the persistent sublayout
      let actualHeight = 0
      console.log("Has getSublayout method?", 'getSublayout' in layout)

      if ('getSublayout' in layout) {
        try {
          const sublayout = (layout as any).getSublayout(layoutKey)
          console.log("Sublayout exists?", !!sublayout)
          console.log("Sublayout type:", sublayout?.constructor?.name)
          console.log("Sublayout pitchX:", (sublayout as any)?.pitchX)
          console.log("Sublayout pitchY:", (sublayout as any)?.pitchY)
          console.log("Sublayout pTotalHeight:", (sublayout as any)?.pTotalHeight)
          console.log("Has getTotalHeight?", sublayout && typeof sublayout.getTotalHeight === 'function')

          if (sublayout && typeof sublayout.getTotalHeight === 'function') {
            const sublayoutHeight = sublayout.getTotalHeight()
            console.log("Got height from sublayout:", sublayoutHeight)

            // Validate the height - getTotalHeight() can return NaN
            if (Number.isFinite(sublayoutHeight) && sublayoutHeight > 0) {
              actualHeight = sublayoutHeight
            } else {
              console.warn('[SubtrackRenderer] Invalid height from sublayout:', sublayoutHeight, 'using default')
            }
          } else {
            console.log("Sublayout check failed - using default height")
          }
        } catch (e) {
          console.warn('[SubtrackRenderer] Failed to query sublayout height:', e)
        }
      } else {
        console.log("Layout does not have getSublayout method")
      }

        console.log("ACTUALHeight=" + actualHeight)
        
      const height = Math.max(actualHeight, subtrackConfig.perSubtrackHeight)

      subtrackPositions.set(subtrack.label, {
        label: subtrack.label,
        yOffset: currentY,
        height,
        visible: true,
      })

      currentY += height + subtrackConfig.spacing
    }
  }

  console.log('[SubtrackRenderer] Layout complete:', {
    layoutRecords: layoutRecords.length,
    matchedFeatures: matchedCount,
    filteredOutFeatures: filteredCount,
    subtrackPositions: Array.from(subtrackPositions.entries()).map(([label, info]) => ({
      label,
      yOffset: info.yOffset,
      height: info.height
    })),
  })

  return { layoutRecords, subtrackPositions }
}
