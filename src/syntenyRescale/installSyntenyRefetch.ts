import { getConf } from '@jbrowse/core/configuration'
import { extendDisplayType } from '@jbrowse/core/pluggableElementTypes'
import { getContainingTrack, getContainingView } from '@jbrowse/core/util'

import { refetchWindowOf } from './refetchWindow'

import '../displayExtension/registry'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { IAnyModelType, IAnyStateTreeNode } from '@jbrowse/mobx-state-tree'

const ADAPTER = 'SyntenyRescaleAdapter'

/**
 * How far the view may move before the rescale is recomputed, as a fraction of
 * the window. A quarter screen is about four fetches across a full pan, which
 * keeps the arithmetic honest without refetching per frame.
 */
const STEP_FRACTION = 0.25

/**
 * Whether this display's data is repositioned per window. Read off the adapter
 * type, because the cost here is a refetch on pan and no other track should pay
 * it.
 */
function isRescaled(self: unknown): boolean {
  try {
    const type = getConf(getContainingTrack(self as IAnyStateTreeNode), [
      'adapter',
      'type',
    ])
    return type === ADAPTER
  } catch {
    return false
  }
}

function viewportOf(self: unknown) {
  const view = getContainingView(self as IAnyStateTreeNode) as unknown as {
    dynamicBlocks?: { contentBlocks?: { refName: string }[] }
    coarseDynamicBlocks?: unknown
    visibleRegions?: { refName: string; start: number; end: number }[]
  }
  const regions = view.visibleRegions
  if (!regions?.length) {
    return undefined
  }
  const first = regions[0]!
  const last = regions.at(-1)!
  return {
    refName: first.refName,
    start: Math.min(first.start, last.start),
    end: Math.max(first.end, last.end),
  }
}

/**
 * Makes the display refetch as the viewport moves, so a window-dependent
 * placement is recomputed instead of held.
 *
 * `zoomFetchArgs` and not `rpcProps`: both force a refetch when their value
 * changes, but a `zoomFetchArgs` change lets the held regions keep drawing
 * until the new data lands, while `rpcProps` scrims them. Panning a track that
 * greys out on every step would be unusable.
 */
export default function installSyntenyRefetch(pluginManager: PluginManager) {
  extendDisplayType(pluginManager, 'LinearBasicDisplay', stateModel =>
    (stateModel as IAnyModelType).views(self => {
      // `zoomFetchArgs` is a view upstream, deliberately: MobX runs an action
      // inside `untracked`, so as an action the viewport read would register no
      // dependency and the display would keep a stale answer.
      const superZoomFetchArgs = self.zoomFetchArgs
      return {
        zoomFetchArgs() {
          const base = superZoomFetchArgs.call(self) as object
          if (!isRescaled(self)) {
            return base
          }
          const viewport = viewportOf(self)
          return viewport
            ? {
                ...base,
                syntenyWindow: refetchWindowOf(viewport, STEP_FRACTION),
              }
            : base
        },
      }
    }),
  )
}
