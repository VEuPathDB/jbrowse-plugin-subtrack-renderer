import { lazy } from 'react'

import { getConf } from '@jbrowse/core/configuration'
import { extendDisplayType } from '@jbrowse/core/pluggableElementTypes'
import { getContainingTrack, getDialogHost } from '@jbrowse/core/util'
import { cast, types } from '@jbrowse/mobx-state-tree'

import { resolveSubtracks } from '../resolveSubtracks'

import './registry'

import type { Lane } from '../SubtrackAdapter/laneKey'
import type PluginManager from '@jbrowse/core/PluginManager'
import type { MenuItem } from '@jbrowse/core/ui'
import type { IAnyModelType, IAnyStateTreeNode } from '@jbrowse/mobx-state-tree'

const SubtrackSelectorDialog = lazy(
  () => import('../SubtrackSelector/SubtrackSelectorDialog'),
)

/**
 * Returned unchanged when nothing is hidden. A module constant, not a fresh Set
 * per read: downstream layout memos compare by identity, so a new empty Set
 * every call reads as a change on every recompute.
 *
 * Core spells this `NO_HIDDEN_GROUPS` in `@jbrowse/display-kit`, which is NOT on
 * core's ReExports list — importing it would bundle a private copy of that
 * package. Declaring our own costs one empty Set.
 */
const NONE: ReadonlySet<string> = new Set()

/**
 * This extension composes onto EVERY LinearBasicDisplay, including tracks with
 * nothing to do with subtracks, so every behavior it adds is gated on the track
 * actually being configured for them.
 */
function isSubtrackTrack(self: unknown) {
  try {
    return (
      getConf(getContainingTrack(self), ['adapter', 'type']) ===
      'SubtrackAdapter'
    )
  } catch {
    // a display not yet attached to a track has no adapter to ask about
    return false
  }
}

export default function installDisplayExtension(pluginManager: PluginManager) {
  extendDisplayType(pluginManager, 'LinearBasicDisplay', stateModel =>
    (stateModel as IAnyModelType)
      .props({
        subtrackSelection: types.maybe(types.array(types.string)),
      })
      .views(self => ({
        get subtrackCatalog(): Lane[] {
          if (!isSubtrackTrack(self)) {
            return []
          }
          return (
            (getConf(getContainingTrack(self as IAnyStateTreeNode), [
              'adapter',
              'lanes',
            ]) as Lane[] | undefined) ?? []
          )
        },
      }))
      .views(self => ({
        /**
         * Lanes this display hides on its own behalf: every catalog lane the
         * reader's selection leaves out. `resolveSubtracks` dedupes the catalog
         * and drops selections naming a retired lane, so a stale session
         * degrades instead of hiding real lanes.
         *
         * A getter, not an action: visibility is DERIVED from the selection, so
         * there is no second copy of the truth, and the reader's own chip-hiding
         * composes on top via HiddenGroupsMixin's `hiddenGroupKeys`.
         */
        get displayHiddenGroupKeys(): ReadonlySet<string> {
          const sel = self.subtrackSelection
          if (!sel || !isSubtrackTrack(self)) {
            return NONE
          }
          const catalog: Lane[] = self.subtrackCatalog
          const keep = new Set(
            resolveSubtracks(catalog, [...sel]).map(l => l.label),
          )
          const hidden = catalog
            .map(l => l.label)
            .filter(label => !keep.has(label))
          return hidden.length === 0 ? NONE : new Set(hidden)
        },
      }))
      .actions(self => ({
        setSubtrackSelection(labels: string[]) {
          self.subtrackSelection = cast(labels)
        },
        resetSubtrackSelection() {
          self.subtrackSelection = undefined
        },
        openSubtrackSelector() {
          // getDialogHost is `#api core/util`: "where a display puts a dialog it
          // cannot mount itself". A display model holds no React component in
          // v5, so this is the only route.
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
            if (!isSubtrackTrack(self)) {
              return base
            }
            // Upstream's "Group by..." calls applyGroupBy, which would replace
            // our {type:'attribute', attribute:'subtrack'} wholesale. Picking
            // Strand there makes the lanes vanish and leaves the lane-label
            // hidden keys matching no section — a silent break, so the entry
            // comes off on tracks we own. Every other track keeps it.
            return [
              ...base.filter(
                item => !('label' in item) || item.label !== 'Group by...',
              ),
              {
                label: 'Select subtracks...',
                onClick: () => {
                  self.openSubtrackSelector()
                },
              },
            ]
          },
        }
      }),
  )
}
