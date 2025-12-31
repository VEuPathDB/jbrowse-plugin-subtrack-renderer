import { BoxRendererType } from '@jbrowse/core/pluggableElementTypes'
import MultiLayout from '@jbrowse/core/util/layouts/MultiLayout'
import GranularRectLayout from '@jbrowse/core/util/layouts/GranularRectLayout'

import { doAll } from './doAll'

import type { RenderArgsDeserialized } from '@jbrowse/core/pluggableElementTypes/renderers/BoxRendererType'
import type { SerializedLayout } from '@jbrowse/core/util/layouts/BaseLayout'

export default class SubtrackFeatureRenderer extends BoxRendererType {
  // TODO: Implement SVG rendering for subtracks
  supportsSVG = false

  // Store subtrack heights persistently across renders
  // Key: refName, Value: Map<subtrackLabel, height>
  private subtrackHeightCache = new Map<string, Map<string, number>>()

  /**
   * Override to handle MultiLayout serialization.
   * MultiLayout doesn't have serializeRegion, but its sublayouts do.
   * We completely override to avoid parent's serializeRegion call.
   */
  serializeResultsInWorker(
    results: any,
    args: RenderArgsDeserialized,
  ): any {
    // Extract everything we need from results
    const { reactElement, features, layout: resultLayout, height, width, ...rest } = results

    // Manually do what FeatureRendererType does: serialize features
    let serializedFeatures: any[] | undefined
    if (features instanceof Map) {
      serializedFeatures = Array.from(features.values(), f => f.toJSON())
    } else if (Array.isArray(features)) {
      // Already an array, just serialize
      serializedFeatures = features.map((f: any) =>
        typeof f.toJSON === 'function' ? f.toJSON() : f
      )
    } else {
      serializedFeatures = undefined
    }

    const region = args.regions[0]!

    // Serialize layout - handle MultiLayout specially
    let layout: SerializedLayout
    if (resultLayout && typeof resultLayout.toJSON === 'function' && 'subLayouts' in resultLayout) {
      // This is a MultiLayout - serialize it by merging sublayouts
      const sublayoutsData = resultLayout.toJSON()

      // Merge all sublayout rectangles into a single rectangles object
      const rectangles: Record<string, any> = {}
      let maxHeightReached = false

      for (const [, sublayoutData] of Object.entries(sublayoutsData)) {
        const data = sublayoutData as SerializedLayout
        Object.assign(rectangles, data.rectangles)
        maxHeightReached = maxHeightReached || data.maxHeightReached
      }

      // CRITICAL: Use the height we calculated in doAll(), not the max sublayout height!
      // Sublayouts overlap at Y=0, we apply yOffsets during rendering
      layout = {
        rectangles,
        totalHeight: height || 100, // Use the calculated total height from results
        maxHeightReached,
      }
    } else if (resultLayout && 'serializeRegion' in resultLayout) {
      // Single layout with serializeRegion (standard case)
      layout = resultLayout.serializeRegion(this.getExpandedRegion(region, args))
    } else {
      // Already serialized
      layout = resultLayout as SerializedLayout
    }

    // Filter features to only those visible in the layout
    const visibleFeatures = serializedFeatures
      ? serializedFeatures.filter((f: any) => !!layout.rectangles[f.uniqueId])
      : undefined

    console.log('[SubtrackRenderer] serializeResultsInWorker:', {
      totalFeatures: serializedFeatures?.length,
      visibleFeatures: visibleFeatures?.length,
      hasLayout: !!layout,
      rectangleCount: Object.keys(layout.rectangles).length,
      width,
      height,
    })

    // Return what BoxRendererType would return, plus width and height
    return {
      ...rest,
      layout,
      maxHeightReached: layout.maxHeightReached,
      features: visibleFeatures,
      width,
      height,
    }
  }

  async render(renderProps: RenderArgsDeserialized) {
    const features = await this.getFeatures(renderProps)

    // Create or recreate MultiLayout for subtracks
    // Note: We need to recreate it if bpPerPx changes (zoom level change)
    const { regions, bpPerPx } = renderProps
    const region = regions[0]!

    console.log('[SubtrackRenderer] Render called:', {
      region: `${region.refName}:${region.start}-${region.end}`,
      featureCount: features.size,
      bpPerPx,
    })

    // Always create a new MultiLayout for each render to ensure correct pitchX
    // (pitchX = bpPerPx, which changes on zoom)
    const layout = new MultiLayout(GranularRectLayout, {
      pitchX: bpPerPx,
      pitchY: 3,
    })

    const width = Math.max(1, (region.end - region.start) / bpPerPx)

    const res = await doAll({
      pluginManager: this.pluginManager,
      renderProps,
      layout,
      features,
      subtrackHeightCache: this.subtrackHeightCache,
    })

    // Height is calculated in doAll() and returned in res.height
    const height = res.height ?? 100

    const result = {
      ...res,
      features, // Keep as Map for serializeResultsInWorker
      layout,
      height,
      width,
      maxHeightReached: layout.maxHeightReached,
    }

    console.log('[SubtrackRenderer] render() returning:', {
      hasImageData: !!(result as any).imageData,
      hasReactElement: !!(result as any).reactElement,
      height: result.height,
      width: result.width,
      featureCount: features.size,
    })

    return result
  }
}
