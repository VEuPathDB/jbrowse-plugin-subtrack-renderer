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
import type { LayoutRecord, SubtrackLayout } from './types'
import type PluginManager from '@jbrowse/core/PluginManager'
import type { Feature, Region } from '@jbrowse/core/util'

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
  layout: SubtrackLayout
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
    // If subtracks are enabled, filter features
    let subtrack: Subtrack | null = null
    let subtrackInfo: SubtrackInfo | undefined

    if (subtrackConfig.enabled) {
      subtrack = getFeatureSubtrack(feature, subtracks)
      if (!subtrack) {
        // Feature doesn't match any visible subtrack - skip it
        continue
      }

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

    // Which sublayout of the MultiLayout this feature is packed into. With
    // subtracks on, that is one lane per subtrack. With subtracks off, every
    // feature must share ONE sublayout so they stack and collide normally --
    // keying by feature.id() here gave each feature a private sublayout, so
    // every feature landed at y=0 on top of every other one. Core's canvas
    // renderer does the same thing via getSublayout(regions[0].refName).
    const layoutKey = subtrack
      ? buildLayoutKey(region.refName, subtrack.label)
      : region.refName

    // Calculate the total height needed including floating labels
    let floatingLabelsHeight = 0
    if (floatingLabels.length > 0) {
      // Find the maximum relativeY + font height + padding for descenders
      const maxRelativeY = Math.max(...floatingLabels.map(l => l.relativeY))
      floatingLabelsHeight = maxRelativeY + 15 // 11px font height + 4px descenders/padding
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
      layoutKey, // layoutName -- MultiLayout takes this leading arg
      feature.id(), // id
      layoutStart, // left
      layoutEnd, // right
      rectHeight, // height
      // MultiLayout declares data as Record<string, T>, but it only ever hands
      // the value straight through to the sublayout, which stores it opaquely.
      // A Feature is what the glyphs expect to get back out.
      feature as unknown as Record<string, unknown>, // data
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

  // Lane yOffsets are deliberately NOT computed here. Lane geometry is shared
  // by every block in the visible region, so it is owned by the display and
  // handed to doAll() via renderProps -- see doAll.ts. This function only lays
  // features out within their own lane (topPx is sublayout-relative).

  return { layoutRecords, subtrackPositions }
}
