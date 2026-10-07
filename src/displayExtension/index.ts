import { lazy } from 'react'

import { getConf } from '@jbrowse/core/configuration'
import { extendDisplayType } from '@jbrowse/core/pluggableElementTypes'
import { getContainingTrack, getDialogHost } from '@jbrowse/core/util'
import { cast, types } from '@jbrowse/mobx-state-tree'

import { resolveSubtracks } from '../resolveSubtracks'

import './registry'

import type { Lane } from '../subtrackCatalog'
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
 */
const NONE: ReadonlySet<string> = new Set()

function trackMetadata(self: unknown): Record<string, unknown> {
  try {
    return (
      (getConf(getContainingTrack(self as IAnyStateTreeNode), 'metadata') as
        Record<string, unknown> | undefined) ?? {}
    )
  } catch {
    // a display not yet attached to a track has no config to ask
    return {}
  }
}

/**
 * The declared lanes, from the track's generic `metadata` slot. JBrowse has no
 * notion of per-section metadata — a section is `{key, label}` derived from the
 * data — so the catalog is the one thing this plugin contributes beyond the
 * picker itself.
 */
function catalogOf(self: unknown): Lane[] {
  const lanes = trackMetadata(self).subtracks
  return Array.isArray(lanes) ? (lanes as Lane[]) : []
}

/**
 * The field the display facets on, '' while ungrouped. Read through one helper
 * because `self` is `any` under the state-model cast, so every call site would
 * otherwise widen an untyped value into `getConf`.
 */
function facetFieldOf(self: unknown): string {
  return (getConf(self as IAnyStateTreeNode, ['facet', 'field']) ??
    '') as string
}

export default function installDisplayExtension(pluginManager: PluginManager) {
  extendDisplayType(pluginManager, 'LinearBasicDisplay', stateModel =>
    (stateModel as IAnyModelType)
      .props({
        /**
         * The reader's chosen lanes, in their chosen order. `undefined` means
         * "not chosen yet", which resolveSubtracks reads as "fall back to the
         * catalog defaults" — so undefined and [] are different answers.
         *
         * A prop, not a volatile: HiddenGroupsMixin's own `hiddenGroups` is
         * volatile and dies on reload, which is fine for a chip the reader
         * flicked off and wrong for a curated lane selection.
         */
        subtrackSelection: types.maybe(types.array(types.string)),
      })
      .views(self => ({
        get subtrackCatalog(): Lane[] {
          return catalogOf(self)
        },
        /**
         * Subtracks are configured when the track declares a catalog AND the
         * display facets on something. Without a facet field there are no
         * sections to pick among, so the picker would have nothing to write to.
         */
        get hasSubtracks(): boolean {
          return catalogOf(self).length > 0 && !!facetFieldOf(self)
        },
      }))
      .views(self => ({
        /**
         * Lanes this display hides on its own behalf: every catalog lane the
         * reader's selection leaves out. `resolveSubtracks` dedupes the catalog
         * and drops selections naming a retired lane, so a stale session
         * degrades instead of hiding real lanes.
         *
         * Derived rather than stored, so there is no second copy of the truth;
         * the reader's own chip-hiding composes on top through
         * HiddenGroupsMixin's `hiddenGroupKeys`.
         */
        get displayHiddenGroupKeys(): ReadonlySet<string> {
          if (!self.hasSubtracks) {
            return NONE
          }
          const catalog: Lane[] = self.subtrackCatalog
          const sel = self.subtrackSelection
          // Undefined selection is not "show everything" -- it is "the reader
          // has not chosen yet", and resolveSubtracks answers it with the
          // catalog's own `visible` defaults. A track declaring hundreds of
          // lanes opens on the handful it marks visible, not on all of them.
          const keep = new Set(
            resolveSubtracks(catalog, sel ? [...sel] : undefined).map(
              l => l.label,
            ),
          )
          const hidden = catalog
            .map(l => l.label)
            .filter((label: string) => !keep.has(label))
          return hidden.length === 0 ? NONE : new Set(hidden)
        },
      }))
      .actions(self => ({
        /**
         * One reader action writes both halves: the order goes to the facet's
         * `domain`, the membership to our own prop, which the hidden-keys getter
         * derives from. `domain` is no part of `groupKeySpace`, so writing it
         * does not reset what the reader hid from a chip.
         */
        setSubtrackSelection(labels: string[]) {
          self.subtrackSelection = cast(labels)
          const field = facetFieldOf(self)
          if (field) {
            self.setFacet({ field, domain: labels })
          }
        },
        resetSubtrackSelection() {
          self.subtrackSelection = undefined
          const field = facetFieldOf(self)
          if (field) {
            self.setFacet({ field, domain: [] })
          }
        },
        openSubtrackSelector() {
          // `getDialogHost` is `#api core/util`: where a display puts a dialog it
          // cannot mount itself. A v5 display model holds no React component.
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
            if (!self.hasSubtracks) {
              return base
            }
            // "Group by..." rewrites the facet field wholesale, which would
            // repoint the sections at a different key space and strand every
            // catalog label. Our picker is the supported route on these tracks;
            // every other track keeps the stock entry.
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
