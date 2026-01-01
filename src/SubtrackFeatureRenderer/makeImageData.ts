import { readConfObject } from '@jbrowse/core/configuration'
import { createJBrowseTheme } from '@jbrowse/core/ui'
import { bpToPx } from '@jbrowse/core/util'
import Flatbush from 'flatbush'

import { drawFeature } from './drawFeature'
import { buildChildrenIndex, convertToCanvasCoords } from './layoutUtils'
import type { SubtrackConfig, SubtrackInfo } from './subtrackUtils'

// Inline stop token utilities to avoid dependency issues
interface LastStopTokenCheck {
  time: number
  iters: number
  stopToken?: string
}

function createStopTokenChecker(stopToken: string | undefined) {
  return {
    time: Date.now(),
    iters: 0,
    stopToken,
  }
}

function checkStopToken2(lastCheck?: LastStopTokenCheck) {
  if (!lastCheck) {
    return
  }
  const { stopToken } = lastCheck
  lastCheck.iters++
  if (stopToken === undefined) {
    return
  }
  // Only check every 100 iterations and every 50ms
  if (lastCheck.iters % 100 !== 0) {
    return
  }
  const now = Date.now()
  if (now - lastCheck.time > 50) {
    lastCheck.time = now
    // Simple check - in web worker context, could use XHR to check if token is revoked
    // For now just update the time
  }
}

import type { RenderConfigContext } from './renderConfig'
import type {
  DrawContext,
  FlatbushItem,
  LayoutRecord,
  RenderArgs,
  SubfeatureInfo,
} from './types'

function buildFlatbush(coords: number[], count: number) {
  const fb = new Flatbush(Math.max(count, 1))
  if (coords.length) {
    for (let i = 0; i < coords.length; i += 4) {
      fb.add(coords[i]!, coords[i + 1]!, coords[i + 2], coords[i + 3])
    }
  } else {
    fb.add(0, 0, 0, 0)
  }
  fb.finish()
  return fb
}

/**
 * Phase 2: Render all features to canvas.
 *
 * This is the draw phase of the two-phase rendering:
 * 1. Layouts have already been computed in Phase 1 (layoutFeatures)
 * 2. Here we convert local coords to canvas coords and draw each feature
 * 3. Build Flatbush spatial indexes for hit detection
 */
export function makeImageData({
  ctx,
  layoutRecords,
  canvasWidth,
  renderArgs,
  configContext,
  subtrackPositions,
  subtrackConfig,
}: {
  ctx: CanvasRenderingContext2D
  layoutRecords: LayoutRecord[]
  canvasWidth: number
  renderArgs: RenderArgs
  configContext: RenderConfigContext
  subtrackPositions?: Map<string, SubtrackInfo>
  subtrackConfig?: SubtrackConfig
}) {
  const {
    bpPerPx,
    regions,
    theme: configTheme,
    stopToken,
    layout,
    peptideDataMap,
    colorByCDS,
    pluginManager,
  } = renderArgs

  const region = regions[0]!
  const theme = createJBrowseTheme(configTheme)

  // Create draw context once - shared across all features
  const drawContext: DrawContext = {
    region,
    bpPerPx,
    configContext,
    theme,
    canvasWidth,
    peptideDataMap,
    colorByCDS,
  }

  // Hit detection data
  const coords: number[] = []
  const items: FlatbushItem[] = []
  const subfeatureCoords: number[] = []
  const subfeatureInfos: SubfeatureInfo[] = []

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  const { subfeatureLabels, transcriptTypes, config } = configContext
  const lastCheck = createStopTokenChecker(stopToken)

  for (const record of layoutRecords) {
    const {
      feature,
      layout: featureLayout,
      topPx: recordTopPx,
      label,
      description,
      subtrackLabel,
      floatingLabels,
    } = record

    // Apply subtrack yOffset during rendering (not during layout)
    // recordTopPx is sublayout-relative (starts at 0), add yOffset to get final position
    let finalTopPx = recordTopPx
    if (subtrackLabel && subtrackPositions) {
      const subtrackInfo = subtrackPositions.get(subtrackLabel)
      if (subtrackInfo) {
        finalTopPx = recordTopPx + subtrackInfo.yOffset
      } else {
        console.warn('[SubtrackRenderer] No subtrack info found for:', subtrackLabel)
      }
    }

    // Convert local coordinates to canvas coordinates
    const featureStartBp = feature.get(region.reversed ? 'end' : 'start')
    const startPx = bpToPx(featureStartBp, region, bpPerPx)
    const canvasLayout = convertToCanvasCoords(
      featureLayout,
      startPx,
      finalTopPx,
    )

    // Draw the feature (all coordinates are now in canvas space)
    drawFeature(ctx, canvasLayout, drawContext, pluginManager)

    // Calculate floating labels height for hit detection bounds
    let floatingLabelsHeight = 0
    if (floatingLabels && floatingLabels.length > 0) {
      const maxRelativeY = Math.max(...floatingLabels.map(l => l.relativeY))
      floatingLabelsHeight = maxRelativeY + 11 // 11px font height (matches rendering)
    }

    // Build hit detection indexes - extend bounds to include floating labels
    const bounds = {
      left: canvasLayout.x,
      right: canvasLayout.x + canvasLayout.totalLayoutWidth,
      top: canvasLayout.y,
      bottom: canvasLayout.y + canvasLayout.totalLayoutHeight + floatingLabelsHeight,
    }

    const tooltip = String(
      readConfObject(config, 'mouseover', { feature, label, description }) ||
        '',
    )

    coords.push(bounds.left, bounds.top, bounds.right, bounds.bottom)
    items.push({
      featureId: feature.id(),
      type: 'box',
      startBp: feature.get('start'),
      endBp: feature.get('end'),
      leftPx: bounds.left,
      rightPx: bounds.right,
      topPx: bounds.top,
      bottomPx: bounds.bottom,
      tooltip,
    })

    // Build subfeature index for hit detection and floating labels
    buildChildrenIndex({
      layout,
      featureLayout: canvasLayout,
      subfeatureCoords,
      subfeatureInfos,
      config,
      configContext,
      pluginManager,
      subfeatureLabels,
      transcriptTypes,
      labelColor: theme.palette.text.primary,
      parentTooltip: tooltip,
    })

    checkStopToken2(lastCheck)
  }

  // Draw floating labels for features
  ctx.save()
  ctx.font = '11px sans-serif' // Match FLOATING_LABEL_FONT_SIZE
  for (const { floatingLabels, layout: featureLayoutData, topPx, subtrackLabel, feature } of layoutRecords) {
    if (!floatingLabels || floatingLabels.length === 0) {
      continue
    }

    // Calculate yOffset for this feature's subtrack
    const yOffset = subtrackLabel && subtrackPositions
      ? (subtrackPositions.get(subtrackLabel)?.yOffset ?? 0)
      : 0

    // Calculate feature's screen position
    const featureStart = feature.get('start')
    const featureLeftPx = (featureStart - region.start) / bpPerPx
    const featureBottomPx = topPx + featureLayoutData.height + yOffset

    for (const label of floatingLabels) {
      const { relativeY, color, text } = label
      if (!text) {
        continue
      }

      // Position label at feature's left edge, offset from bottom by relativeY
      const labelY = featureBottomPx + relativeY + 11 // +11 for font height

      ctx.fillStyle = color || theme.palette.text.primary
      ctx.fillText(text, featureLeftPx, labelY)
    }
  }
  ctx.restore()

  // Draw subtrack labels and dividers if enabled
  if (
    subtrackConfig?.enabled &&
    subtrackConfig.showLabels &&
    subtrackPositions &&
    subtrackPositions.size > 0
  ) {
    ctx.save()
    ctx.font = '12px sans-serif'
    ctx.fillStyle = theme.palette.text.secondary

    for (const [, info] of subtrackPositions) {
      // Draw label at left edge
      ctx.fillText(info.label, 5, info.yOffset + 5)

      // Draw divider line
      ctx.strokeStyle = theme.palette.divider
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, info.yOffset + info.height)
      ctx.lineTo(canvasWidth, info.yOffset + info.height)
      ctx.stroke()
    }

    ctx.restore()
  }

  return {
    flatbush: buildFlatbush(coords, items.length).data,
    items,
    subfeatureFlatbush: buildFlatbush(subfeatureCoords, subfeatureInfos.length)
      .data,
    subfeatureInfos,
  }
}
