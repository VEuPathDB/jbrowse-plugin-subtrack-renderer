import React from 'react'

import OverlayCanvas from '@jbrowse/render-core/OverlayCanvas'
import { observer } from 'mobx-react'

import { orthologGroupOf } from '../syntenyRescale/syntenyFeatureId'
import { buildRibbons, ribbonPolygon } from './ribbonGeometry'

import type { RibbonBox, RibbonPolygon } from './ribbonGeometry'

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
    bpPerPx: number
    width: number
    dynamicBlocks: { contentBlocks: { refName: string }[] }
  }
}) {
  const { scrollTop, height } = model
  const width = view.width

  // Everything reactive is read HERE, in the render body, not inside `draw`.
  // `draw` runs from an effect, which is outside mobx's tracking, so a closure
  // that reads the view there observes nothing and the overlay goes stale on
  // pan and zoom while looking correct on first paint. Reading during render
  // makes `observer` re-render on exactly these values, which changes `draw`'s
  // identity, which is what re-runs it.
  const polygons: RibbonPolygon[] = []
  const refName = view.dynamicBlocks.contentBlocks[0]?.refName
  // `offsetPx` and `bpPerPx` are the pan and the zoom: both are read through
  // bpToPx below, and reading them by name as well keeps the dependency even if
  // every feature happens to fall outside the view.
  const { offsetPx, bpPerPx } = view
  void bpPerPx
  if (model.showsSyntenyRibbons && refName) {
    const bpToPx = (bp: number) => {
      const at = view.bpToPx({ refName, coord: bp })
      return at === undefined ? Number.NaN : at.offsetPx - offsetPx
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
    for (const ribbon of buildRibbons(boxes, lanes)) {
      const poly = ribbonPolygon(ribbon, bpToPx, scrollTop, width)
      if (poly) {
        polygons.push(poly)
      }
    }
  }

  // Deliberately not memoized: `polygons` is a fresh array per render, so the
  // closure's identity already changes exactly when the geometry does, and
  // OverlayCanvas re-runs it on that. A render only happens when something
  // tracked above moved, so this is not a redraw per frame.
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = FILL
    ctx.strokeStyle = STROKE
    ctx.lineWidth = 0.5
    for (const poly of polygons) {
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
  }

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
