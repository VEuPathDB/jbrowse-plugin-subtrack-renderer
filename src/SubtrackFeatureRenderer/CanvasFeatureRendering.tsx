import React, { useCallback, useMemo, useRef, useState } from 'react'

import { PrerenderedCanvas } from '@jbrowse/core/ui'
import { getSession } from '@jbrowse/core/util'
import Flatbush from 'flatbush'
import { observer } from 'mobx-react'

import type { FlatbushItem, SubfeatureInfo } from './types'
import type { Region } from '@jbrowse/core/util/types'

interface DisplayModel {
  selectedFeatureId?: string
  featureIdUnderMouse?: string
  subfeatureIdUnderMouse?: string
  contextMenuFeature?: { id: () => string }
  setContextMenuFeature: (feature: unknown) => void
  setFeatureIdUnderMouse: (id: string | undefined) => void
  setSubfeatureIdUnderMouse: (id: string | undefined) => void
  setMouseoverExtraInformation: (info: unknown) => void
  selectFeatureById: (featureId: string, parentFeatureId?: string) => Promise<void>
  clearFeatureSelection: () => void
  setContextMenuFeatureById: (featureId: string, parentFeatureId?: string) => Promise<void>
}

const CanvasFeatureRendering = observer(function CanvasFeatureRendering(props: {
  blockKey: string
  displayModel: DisplayModel
  width: number
  height: number
  regions: Region[]
  bpPerPx: number
  items: FlatbushItem[]
  flatbush: ArrayBufferLike
  subfeatureInfos?: SubfeatureInfo[]
  subfeatureFlatbush?: ArrayBufferLike
  imageData?: unknown
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const {
    displayModel,
    width,
    height,
    flatbush,
    items,
    subfeatureFlatbush,
    subfeatureInfos = [],
    imageData,
    onContextMenu,
  } = props
  const flatbush2 = useMemo(() => Flatbush.from(flatbush), [flatbush])
  const subfeatureFlatbush2 = useMemo(
    () => (subfeatureFlatbush ? Flatbush.from(subfeatureFlatbush) : null),
    [subfeatureFlatbush],
  )

  // Create efficient lookup map for items by feature ID
  const itemsById = useMemo(() => {
    const map = new Map<string, FlatbushItem>()
    for (const item of items) {
      map.set(item.featureId, item)
    }
    return map
  }, [items])

  const {
    selectedFeatureId,
    featureIdUnderMouse,
    subfeatureIdUnderMouse,
    contextMenuFeature,
  } = displayModel

  const ref = useRef<HTMLDivElement>(null)
  const [mouseIsDown, setMouseIsDown] = useState(false)
  const [movedDuringLastMouseDown, setMovedDuringLastMouseDown] =
    useState(false)
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)

  // Create lookup map for subfeatureInfos by featureId
  const subfeatureInfosById = useMemo(() => {
    const map = new Map<string, SubfeatureInfo>()
    for (const info of subfeatureInfos) {
      map.set(info.featureId, info)
    }
    return map
  }, [subfeatureInfos])

  // Hit detection helper - finds feature/subfeature at given coordinates
  const getFeatureAtPosition = useCallback(
    (offsetX: number, offsetY: number) => {
      const search = flatbush2.search(
        offsetX,
        offsetY,
        offsetX + 1,
        offsetY + 1,
      )
      const item = search.length ? items[search[0]!] : undefined
      if (!item) {
        return {
          item: undefined,
          featureId: undefined,
          parentFeatureId: undefined,
        }
      }

      let featureId = item.featureId
      let parentFeatureId: string | undefined

      if (subfeatureFlatbush2 && subfeatureInfos.length) {
        const subSearch = subfeatureFlatbush2.search(
          offsetX,
          offsetY,
          offsetX + 1,
          offsetY + 1,
        )
        if (subSearch.length) {
          const info = subfeatureInfos[subSearch[0]!]
          if (info) {
            featureId = info.featureId
            parentFeatureId = info.parentFeatureId
          }
        }
      }
      return { item, featureId, parentFeatureId }
    },
    [flatbush2, items, subfeatureFlatbush2, subfeatureInfos],
  )

  // For selected features, check subfeatures first, then items
  const selectedSubfeature = selectedFeatureId
    ? subfeatureInfosById.get(selectedFeatureId)
    : undefined
  const selectedItem =
    selectedFeatureId && !selectedSubfeature
      ? itemsById.get(selectedFeatureId)
      : undefined

  // For highlighted features, use subfeature bounds if available
  const highlightedFeature = featureIdUnderMouse || contextMenuFeature?.id()
  const highlightedSubfeature = subfeatureIdUnderMouse
    ? subfeatureInfosById.get(subfeatureIdUnderMouse)
    : undefined
  const highlightedItem =
    highlightedFeature && !highlightedSubfeature
      ? itemsById.get(highlightedFeature)
      : undefined

  // Convert pixel bounds to display rectangle
  function boundsToRect(
    bounds: {
      leftPx: number
      topPx: number
      rightPx: number
      bottomPx: number
    },
    offset = 2,
  ) {
    const rectTop = Math.round(bounds.topPx)
    const rectHeight = Math.round(bounds.bottomPx - bounds.topPx)
    return {
      left: bounds.leftPx - offset,
      top: rectTop - offset,
      width: bounds.rightPx - bounds.leftPx,
      height: rectHeight,
    }
  }

  const selected = selectedSubfeature
    ? boundsToRect(selectedSubfeature)
    : selectedItem
      ? boundsToRect(selectedItem)
      : undefined
  const highlight = highlightedSubfeature
    ? boundsToRect(highlightedSubfeature, 0)
    : highlightedItem
      ? boundsToRect(highlightedItem, 0)
      : undefined

  const canvasWidth = Math.ceil(width)

  console.log('[CanvasFeatureRendering] Rendering with props:', {
    propsWidth: props.width,
    propsHeight: props.height,
    width,
    height,
    canvasWidth,
    blockKey: props.blockKey,
    flatbushSize: flatbush.byteLength,
    itemsCount: items.length,
    hasImageData: !!imageData,
    imageDataType: imageData?.constructor?.name,
    imageDataWidth: (imageData as any)?.width,
    imageDataHeight: (imageData as any)?.height,
  })

  // Calculate high-DPI scaling factor from ImageBitmap dimensions
  let highResolutionScaling = 1
  if (imageData && typeof (imageData as any).width === 'number') {
    const bitmapWidth = (imageData as any).width
    const bitmapHeight = (imageData as any).height
    highResolutionScaling = Math.round(bitmapWidth / width)

    console.log('[CanvasFeatureRendering] ImageBitmap dimensions:', {
      bitmapWidth,
      bitmapHeight,
      expectedWidth: width,
      expectedHeight: height,
      calculatedScaling: highResolutionScaling,
      devicePixelRatio: window.devicePixelRatio,
    })
  }

  return (
    <div
      ref={ref}
      data-testid="canvas-feature-overlay"
      style={{ position: 'relative', width: canvasWidth, height }}
      onMouseLeave={() => {
        displayModel.setFeatureIdUnderMouse(undefined)
        if (typeof displayModel.setSubfeatureIdUnderMouse === 'function') {
          displayModel.setSubfeatureIdUnderMouse(undefined)
        }
        displayModel.setMouseoverExtraInformation(undefined)
      }}
      onMouseDown={(event: React.MouseEvent) => {
        setMouseIsDown(true)
        setMovedDuringLastMouseDown(false)
        if (ref.current) {
          const rect = ref.current.getBoundingClientRect()
          const scrollT = ref.current.scrollTop
          mouseDownPos.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top + scrollT,
          }
        }
      }}
      onMouseUp={() => {
        setMouseIsDown(false)
      }}
      onMouseMove={event => {
        if (!ref.current) {
          return
        }
        const rect = ref.current.getBoundingClientRect()
        const scrollT = ref.current.scrollTop
        const offsetX = event.clientX - rect.left
        const offsetY = event.clientY - rect.top + scrollT

        // Only set movedDuringLastMouseDown if mouse has moved more than 3px
        if (mouseIsDown && mouseDownPos.current) {
          const dx = offsetX - mouseDownPos.current.x
          const dy = offsetY - mouseDownPos.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (distance > 3) {
            setMovedDuringLastMouseDown(true)
          }
        }

        const { item, featureId, parentFeatureId } = getFeatureAtPosition(
          offsetX,
          offsetY,
        )

        // Build tooltip with subfeature info
        let extra = item?.tooltip
        if (extra && parentFeatureId) {
          const subInfo = subfeatureInfosById.get(featureId)
          if (subInfo) {
            const { displayLabel, type } = subInfo
            extra += `<br/>${displayLabel ? `${displayLabel} (${type})` : type}`
          }
        }

        displayModel.setFeatureIdUnderMouse(item?.featureId)
        if (typeof displayModel.setSubfeatureIdUnderMouse === 'function') {
          displayModel.setSubfeatureIdUnderMouse(
            parentFeatureId ? featureId : undefined,
          )
        }
        displayModel.setMouseoverExtraInformation(extra)
      }}
      onClick={event => {
        console.log('[CanvasFeatureRendering] Click detected:', {
          movedDuringLastMouseDown,
          clientX: event.clientX,
          clientY: event.clientY,
        })
        if (!movedDuringLastMouseDown && ref.current) {
          const rect = ref.current.getBoundingClientRect()
          const scrollT = ref.current.scrollTop
          const offsetX = event.clientX - rect.left
          const offsetY = event.clientY - rect.top + scrollT

          console.log('[CanvasFeatureRendering] Click position:', {
            offsetX,
            offsetY,
            rectLeft: rect.left,
            rectTop: rect.top,
            rectWidth: rect.width,
            rectHeight: rect.height,
          })

          const { item, featureId, parentFeatureId } = getFeatureAtPosition(
            offsetX,
            offsetY,
          )
          console.log('[CanvasFeatureRendering] Hit detection result:', {
            hasItem: !!item,
            featureId,
            parentFeatureId,
          })
          if (item) {
            // Pass the top-level feature ID for RPC lookup since nested
            // subfeature parents may not be in the layout cache
            displayModel
              .selectFeatureById(featureId, parentFeatureId, item.featureId)
              .catch((e: unknown) => {
                console.error(e)
                getSession(displayModel).notifyError(`${e}`, e)
              })
          } else {
            displayModel.clearFeatureSelection()
          }
        }
      }}
      onContextMenu={event => {
        if (ref.current) {
          const rect = ref.current.getBoundingClientRect()
          const scrollT = ref.current.scrollTop
          const offsetX = event.clientX - rect.left
          const offsetY = event.clientY - rect.top + scrollT

          const { item, featureId, parentFeatureId } = getFeatureAtPosition(
            offsetX,
            offsetY,
          )
          if (item) {
            displayModel
              .setContextMenuFeatureById(
                featureId,
                parentFeatureId,
                item.featureId,
              )
              .catch((e: unknown) => {
                console.error(e)
                getSession(displayModel).notifyError(`${e}`, e)
              })
          } else {
            onContextMenu?.(event)
          }
        } else {
          onContextMenu?.(event)
        }
      }}
    >
      <PrerenderedCanvas
        width={width}
        height={height}
        imageData={imageData}
        highResolutionScaling={highResolutionScaling}
        blockKey={props.blockKey}
        style={{ position: 'absolute', left: 0, top: 0 }}
      />
      {highlight ? (
        <div
          style={{
            position: 'absolute',
            backgroundColor: '#00000033',
            pointerEvents: 'none',
            zIndex: 10,
            ...highlight,
          }}
        />
      ) : null}
      {selected ? (
        <div
          style={{
            position: 'absolute',
            border: '2px solid #00b8ff',
            boxSizing: 'content-box',
            pointerEvents: 'none',
            ...selected,
          }}
        />
      ) : null}
    </div>
  )
})

export default CanvasFeatureRendering
