import { reaction } from 'mobx'
import { addDisposer, cast, types, Instance } from '@jbrowse/mobx-state-tree'
import { getConf } from '@jbrowse/core/configuration'
import SerializableFilterChain from '@jbrowse/core/pluggableElementTypes/renderers/util/serializableFilterChain'
import { getSession } from '@jbrowse/core/util'
import deepEqual from 'fast-deep-equal'

import { getLgvExports } from '../lgvExports'
import { resolveSubtracks } from './resolveSubtracks'
import SubtrackSelectorDialog from '../SubtrackSelector/SubtrackSelectorDialog'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

type LaneHeights = Record<string, number>

/**
 * #stateModel SubtrackFeatureDisplay
 * Display model that owns the vertical geometry of the subtrack lanes.
 *
 * Blocks render one after another against a single shared, accumulating
 * layout. If each block worked out its own lane offsets it would see a
 * different set of features than its neighbours and place the lanes
 * differently -- and the blocks that had already drawn would never be told to
 * move. That is why subtracks drifted out of alignment on zoom and pan.
 *
 * So the display, not the renderer, decides how tall each lane is. It reads
 * back the content height every block reports, takes the max across the blocks
 * currently on screen, and publishes the result through renderProps(). Because
 * core's renderBlockData() reads renderProps() inside a mobx reaction,
 * publishing new geometry invalidates EVERY block at once, so the whole visible
 * region redraws with identical lane offsets.
 *
 * This settles in two passes and cannot oscillate: a block's reported content
 * height depends only on its own features, never on the geometry it was handed.
 *
 * extends
 * - [BaseLinearDisplay](../baselineardisplay)
 */
export function stateModelFactory(pluginManager: PluginManager) {
  const { BaseLinearDisplay } = getLgvExports(pluginManager)

  return (
    types
      .compose(
        'SubtrackFeatureDisplay',
        BaseLinearDisplay,
        types.model({
          /**
           * #property
           */
          type: types.literal('SubtrackFeatureDisplay'),
          /**
           * #property
           * Ordered labels of the lanes the user wants to see, top to bottom.
           * For a lane list, selection *is* order, so one property carries both.
           *
           * undefined means "the user has not chosen", so the catalog's own
           * defaults apply. Being an MST property it rides the session snapshot,
           * so a shared session URL carries the user's lane selection -- and a
           * user who never opens the selector adds nothing to the snapshot.
           */
          subtrackSelection: types.maybe(types.array(types.string)),
        }),
      )
      .volatile(() => ({
        /**
         * #volatile
         * Authoritative lane heights, keyed by subtrack label. Every block draws
         * with these, so they are all mutually consistent. Undefined until the
         * first blocks report in.
         */
        laneHeights: undefined as LaneHeights | undefined,
      }))
      .views(self => ({
        /**
         * #getter
         * BaseLinearDisplay does not define this -- core's LinearFeatureDisplay
         * layer does, but that is not published in LinearGenomeViewPlugin.exports.
         * Without it, renderBlockData() dereferences an undefined rendererType.
         */
        get rendererTypeName() {
          return 'SubtrackFeatureRenderer'
        },
        /**
         * #getter
         * The renderer's own config blob (subtracks, subtrackConfig, ...).
         * BaseLinearDisplay does not pass this to the renderer -- core's
         * LinearFeatureDisplay layer is what normally supplies it -- so without
         * this the renderer is handed an empty config and sees no subtracks.
         */
        get rendererConfig() {
          // BaseLinearDisplay arrives untyped from the LGV plugin's exports, so
          // `self` does not structurally satisfy getConf's parameter here
          return getConf(self as any, ['renderer'])
        },
        /**
         * #getter
         * Tallest content height each lane needs across the blocks currently on
         * screen. Derived only from blocks that have finished rendering; blocks
         * still in flight are skipped so a half-drawn screen cannot shrink a lane
         * and then immediately grow it back.
         */
        get requiredLaneHeights(): LaneHeights | undefined {
          const blocks = [...self.blockState.values()] as any[]
          const rendered = blocks.filter(b => !b.isRenderingPending && !b.error)
          if (!rendered.length) {
            return undefined
          }

          const out: LaneHeights = {}
          let sawAny = false
          for (const block of rendered) {
            const reported = block.layout?.subtrackContentHeights as
              LaneHeights | undefined
            if (!reported) {
              continue
            }
            sawAny = true
            for (const [label, h] of Object.entries(reported)) {
              if (Number.isFinite(h)) {
                out[label] = Math.max(out[label] ?? 0, h)
              }
            }
          }
          return sawAny ? out : undefined
        },
        /**
         * #getter
         * Every subtrack the config declares. Read-only: the config declares, the
         * display decides.
         */
        get subtrackCatalog(): Subtrack[] {
          return (self.rendererConfig?.subtracks ?? []) as Subtrack[]
        },
      }))
      .views(self => ({
        /**
         * #getter
         * The ordered, visible lanes to draw: the user's selection resolved
         * against the catalog, or the catalog's defaults if they have not chosen.
         */
        get resolvedSubtracks(): Subtrack[] {
          return resolveSubtracks(
            self.subtrackCatalog,
            self.subtrackSelection ? [...self.subtrackSelection] : undefined,
          )
        },
      }))
      .actions(self => ({
        /**
         * #action
         */
        setLaneHeights(heights: LaneHeights | undefined) {
          self.laneHeights = heights
        },
        /**
         * #action
         */
        setSubtrackSelection(labels: string[]) {
          self.subtrackSelection = cast(labels)
        },
        /**
         * #action
         * Back to the catalog's defaults. Clearing to undefined (rather than
         * writing the default list out) keeps the session snapshot clean and lets
         * a later config change introduce new lanes.
         */
        resetSubtrackSelection() {
          self.subtrackSelection = undefined
        },
      }))
      // Chained after the actions above on purpose: queueDialog is typed against
      // the dialog's props, so `self` must already carry setSubtrackSelection and
      // resetSubtrackSelection to satisfy SubtrackSelectorTarget.
      .views(self => {
        // capture the base implementations before we shadow them
        const superRenderProps = self.renderProps
        const superTrackMenuItems = self.trackMenuItems
        return {
          /**
           * #method
           * Publishing laneHeights here is what makes the whole visible region
           * redraw together: renderBlockData() calls renderProps() inside a mobx
           * reaction, so every block re-renders whenever this value changes.
           */
          renderProps() {
            return {
              ...superRenderProps(),
              config: self.rendererConfig,
              filters: new SerializableFilterChain({ filters: [] }),
              subtrackLaneHeights: self.laneHeights,
              subtracks: self.resolvedSubtracks,
            }
          },
          /**
           * #method
           * The selector is only meaningful on tracks that actually declare
           * subtracks. getConf on a nested schema hands back a snapshot with
           * default-valued slots stripped, and subtrackConfig.enabled defaults to
           * false -- so its presence here is precisely "someone turned subtracks
           * on".
           */
          trackMenuItems() {
            const enabled = getConf(self as any, [
              'renderer',
              'subtrackConfig',
              'enabled',
            ])
            if (!enabled) {
              return superTrackMenuItems()
            }
            return [
              ...superTrackMenuItems(),
              {
                label: 'Select subtracks…',
                onClick: () => {
                  getSession(self).queueDialog(handleClose => [
                    SubtrackSelectorDialog,
                    { display: self, handleClose },
                  ])
                },
              },
            ]
          },
        }
      })
      .actions(self => ({
        afterAttach() {
          // Track what the blocks on screen actually need and republish the
          // geometry whenever it changes. Recomputing from only the *currently
          // visible* blocks is what lets lanes shrink again on zoom-out, instead
          // of ratcheting upward forever the way the old renderer-side height
          // accumulator did.
          addDisposer(
            self,
            reaction(
              () => self.requiredLaneHeights,
              required => {
                if (required && !deepEqual(required, self.laneHeights)) {
                  self.setLaneHeights(required)
                }
              },
              {
                name: 'SubtrackFeatureDisplay-laneGeometry',
                fireImmediately: true,
                // let a burst of blocks finish before republishing, so we redraw
                // once per settled screen rather than once per arriving block
                delay: 100,
              },
            ),
          )
        },
      }))
  )
}

export type SubtrackFeatureDisplayStateModel = ReturnType<
  typeof stateModelFactory
>
export type SubtrackFeatureDisplayModel =
  Instance<SubtrackFeatureDisplayStateModel>
