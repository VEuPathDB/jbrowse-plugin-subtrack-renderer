import { lazy } from 'react'

import { getConf } from '@jbrowse/core/configuration'
import { extendDisplayType } from '@jbrowse/core/pluggableElementTypes'
import { getContainingTrack, getDialogHost } from '@jbrowse/core/util'
import { cast, types } from '@jbrowse/mobx-state-tree'

import {
  filteredAdapterConfig,
  wiggleCatalog,
  wiggleMembers,
} from '../multiWiggle/members'
import { resolveSubtracks } from '../resolveSubtracks'

import type { WiggleMember } from '../multiWiggle/members'
import type { Lane } from '../subtrackCatalog'
import type PluginManager from '@jbrowse/core/PluginManager'
import type { MenuItem } from '@jbrowse/core/ui'
import type { IAnyModelType, IAnyStateTreeNode } from '@jbrowse/mobx-state-tree'

const SubtrackSelectorDialog = lazy(
  () => import('../SubtrackSelector/SubtrackSelectorDialog'),
)

function trackConf(self: unknown, slot: 'adapter' | 'metadata'): unknown {
  try {
    return getConf(getContainingTrack(self as IAnyStateTreeNode), slot)
  } catch {
    // a display not yet attached to a track has no config to ask
    return undefined
  }
}

function defaultSubtracksOf(self: unknown): string[] | undefined {
  const meta = trackConf(self, 'metadata') as
    Record<string, unknown> | undefined
  const d = meta?.defaultSubtracks
  return Array.isArray(d)
    ? d.filter((x): x is string => typeof x === 'string')
    : undefined
}

/**
 * "Select subtracks..." for a MultiWiggleAdapter track. In beta.18 a
 * `MultiLinearWiggleDisplay` config entry folds into LinearWiggleDisplay with
 * its sources on rows, so this is where that display now lives.
 *
 * Hiding works on the fetch, not the paint: `adapterConfig` is overridden to
 * the selected subadapters, so the worker never builds or reads the others.
 * The stock display fetches every source and filters client-side.
 */
export default function installWiggleExtension(pluginManager: PluginManager) {
  extendDisplayType(pluginManager, 'LinearWiggleDisplay', stateModel =>
    (stateModel as IAnyModelType)
      .props({
        /**
         * The reader's chosen subtracks, in order. `undefined` is "not chosen
         * yet", answered by the track's `metadata.defaultSubtracks`.
         */
        subtrackSelection: types.maybe(types.array(types.string)),
      })
      .views(self => ({
        get subtrackMembers(): WiggleMember[] {
          return wiggleMembers(
            trackConf(self, 'adapter') as Record<string, unknown> | undefined,
          )
        },
      }))
      .views(self => ({
        get subtrackCatalog(): Lane[] {
          return wiggleCatalog(self.subtrackMembers, defaultSubtracksOf(self))
        },
        get hasSubtracks(): boolean {
          return self.subtrackMembers.length > 1
        },
      }))
      .views(self => ({
        /** The labels to fetch, in draw order */
        get selectedSubtracks(): string[] {
          const sel: string[] | undefined = self.subtrackSelection
            ? [...self.subtrackSelection]
            : undefined
          return resolveSubtracks(self.subtrackCatalog, sel).map(l => l.label)
        },
      }))
      .views(self => ({
        /**
         * Overrides BaseDisplayModel's getter, which every fetch and clustering
         * RPC of this display reads, and which is part of the fetch key, so a
         * new selection invalidates and refetches every region.
         */
        get adapterConfig(): Record<string, unknown> {
          const adapter = (trackConf(self, 'adapter') ?? {}) as Record<
            string,
            unknown
          >
          return self.hasSubtracks
            ? filteredAdapterConfig(
                adapter,
                self.subtrackMembers,
                self.selectedSubtracks,
              )
            : adapter
        },
      }))
      .actions(self => ({
        /**
         * Held regions are dropped, not just restamped: the display fetches with
         * `sources` set to the rows it has already discovered, and the worker
         * echoes that list back, so a newly selected subtrack would never be
         * asked for.
         */
        setSubtrackSelection(labels: string[]) {
          self.subtrackSelection = cast(labels)
          self.clearAllRpcData()
        },
        resetSubtrackSelection() {
          self.subtrackSelection = undefined
          self.clearAllRpcData()
        },
        openSubtrackSelector() {
          getDialogHost(self as IAnyStateTreeNode).queueDialog(handleClose => [
            SubtrackSelectorDialog,
            { display: self, handleClose },
          ])
        },
      }))
      .actions(self => {
        const superTrackMenuItems = self.trackMenuItems
        return {
          trackMenuItems() {
            const base = superTrackMenuItems() as MenuItem[]
            return self.hasSubtracks
              ? [
                  ...base,
                  {
                    label: 'Select subtracks...',
                    onClick: () => {
                      self.openSubtrackSelector()
                    },
                  },
                ]
              : base
          },
        }
      }),
  )
}
