import React, { useCallback } from 'react'

import OverlayCanvas from '@jbrowse/render-core/OverlayCanvas'
import { observer } from 'mobx-react'

import { orthologGroupOf } from '../syntenyRescale/syntenyFeatureId'
import { buildRibbons, ribbonPolygon } from './ribbonGeometry'

import type { RibbonBox } from './ribbonGeometry'

/** What this layer needs off the display; everything else about it is private. */
export interface RibbonLayerModel {
  showsSyntenyRibbons: boolean
  featureItemMap: Map<string, { item: RibbonItem }>
  groupSections: { key: string }[]
  scrollTop: number
  height: number
}

interface RibbonItem {
  featureId: string
  startBp: number
  endBp: number
  topPx: number
  bottomPx: number
  groupKey?: string
}

const FILL = 'rgba(128,128,128,0.10)'
const STROKE = 'rgba(128,128,128,0.55)'

/**
 * Shading between orthologous genes in different lanes.
 *
 * The geometry is all on one model: `featureItemMap` holds every laid-out
 * feature with its box and its lane (`groupKey`), and `groupSections` gives the
 * lane order. JBrowse 1 had to walk a layout per subtrack and correlate them
 * across per-block canvases, which is why its own notes record shading going
 * incomplete when a block scrolled in; there is no equivalent hazard here
 * because one pass sees every section at once.
 */
const SyntenyRibbonLayer = observer(function SyntenyRibbonLayer({
  model,
  view,
}: {
  model: RibbonLayerModel
  view: {
    bpToPx: (a: {
      refName: string
      coord: number
    }) => { offsetPx: number } | undefined
    offsetPx: number
    width: number
    dynamicBlocks: { contentBlocks: { refName: string }[] }
  }
}) {
  const { scrollTop, height } = model
  const width = view.width

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.clearRect(0, 0, width, height)
      if (!model.showsSyntenyRibbons) {
        return
      }
      const refName = view.dynamicBlocks.contentBlocks[0]?.refName
      if (!refName) {
        return
      }
      const bpToPx = (bp: number) => {
        const at = view.bpToPx({ refName, coord: bp })
        return at === undefined ? Number.NaN : at.offsetPx - view.offsetPx
      }

      const boxes: RibbonBox[] = []
      for (const { item } of model.featureItemMap.values()) {
        const orthologGroup = orthologGroupOf(item.featureId)
        if (orthologGroup && item.groupKey !== undefined) {
          boxes.push({
            group: item.groupKey,
            orthologGroup,
            startBp: item.startBp,
            endBp: item.endBp,
            topPx: item.topPx,
            bottomPx: item.bottomPx,
          })
        }
      }

      const lanes = model.groupSections.map(s => s.key)
      ctx.fillStyle = FILL
      ctx.strokeStyle = STROKE
      ctx.lineWidth = 0.5
      for (const ribbon of buildRibbons(boxes, lanes)) {
        const poly = ribbonPolygon(ribbon, bpToPx, scrollTop, width)
        if (!poly) {
          continue
        }
        ctx.beginPath()
        const [first, ...rest] = poly.points
        ctx.moveTo(first![0], first![1])
        for (const [x, y] of rest) {
          ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    },
    [model, view, width, height, scrollTop],
  )

  return (
    <OverlayCanvas
      width={width}
      height={height}
      draw={draw}
      data-testid="synteny-ribbons"
    />
  )
})

export default SyntenyRibbonLayer
