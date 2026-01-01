import { when, reaction } from 'mobx'
import { addDisposer, types, Instance } from 'mobx-state-tree'

import type PluginManager from '@jbrowse/core/PluginManager'

/**
 * #stateModel SubtrackFeatureDisplay
 * Extended display model for subtrack rendering that monitors block completion
 * and triggers layout revalidation when all blocks are rendered.
 *
 * extends
 * - [BaseLinearDisplay](../baselineardisplay)
 */
export function stateModelFactory(pluginManager: PluginManager) {
  // Get BaseLinearDisplay from plugin manager
  const { BaseLinearDisplay } = pluginManager.lib[
    'Plugin-linear-genome-view'
  ] as any

  return types
    .compose(
      'SubtrackFeatureDisplay',
      BaseLinearDisplay,
      types.model({
        /**
         * #property
         */
        type: types.literal('SubtrackFeatureDisplay'),
      }),
    )
    .volatile(() => ({
      /**
       * #volatile
       * Tracks whether we're currently monitoring blocks
       */
      isMonitoringBlocks: false,
      /**
       * #volatile
       * Tracks whether we've already done the post-render reload
       */
      hasReloadedAfterRender: false,
    }))
    .views(self => ({
      /**
       * #getter
       * Check if all blocks have finished rendering
       */
      get allBlocksRendered(): boolean {
        const blocks = Array.from(self.blockState.values()) as any[]
        if (blocks.length === 0) {
          return false
        }
        return blocks.every(
          block => !block.isRenderingPending || block.error !== undefined,
        )
      },
      /**
       * #getter
       * Get count of pending blocks
       */
      get pendingBlockCount(): number {
        const blocks = Array.from(self.blockState.values()) as any[]
        return blocks.filter(block => block.isRenderingPending).length
      },
    }))
    .actions(self => ({
      /**
       * #action
       * Called when all blocks have finished rendering
       */
      onAllBlocksRendered() {
        // Only reload once per render cycle to avoid infinite loop
        if (self.hasReloadedAfterRender) {
          return
        }

        console.log('[SubtrackFeatureDisplay] All blocks rendered, triggering reload to sync heights')
        self.hasReloadedAfterRender = true

        // Reload to clear and redraw layout with updated heightStats
        // This ensures all blocks use the same MAX heights for consistent yOffsets
        self.reload()
      },
      /**
       * #action
       * Reset the reload flag when blocks change
       */
      resetReloadFlag() {
        self.hasReloadedAfterRender = false
      },
      /**
       * #action
       * Start monitoring blocks for completion
       */
      startBlockMonitoring() {
        if (self.isMonitoringBlocks) {
          return
        }
        self.isMonitoringBlocks = true

        // Reset reload flag for new render cycle
        this.resetReloadFlag()

        // Use MobX when() to wait for all blocks to finish rendering
        const disposer = when(
          // Condition: all blocks are rendered
          () => {
            const blocks = Array.from(self.blockState.values()) as any[]
            if (blocks.length === 0) {
              return false
            }
            const allDone = blocks.every(
              block => !block.isRenderingPending || block.error !== undefined,
            )

            if (allDone) {
              console.log(
                '[SubtrackFeatureDisplay] All blocks finished:',
                blocks.length,
                'blocks',
              )
            }

            return allDone
          },
          // Effect: trigger reload
          () => {
            self.isMonitoringBlocks = false
            this.onAllBlocksRendered()
          },
        )

        // Clean up disposer when display is destroyed
        addDisposer(self, disposer)
      },
    }))
    .actions(self => ({
      /**
       * #action
       * Override reload to restart block monitoring
       */
      afterAttach() {
        // Call parent afterAttach
        // @ts-expect-error accessing parent method
        if (BaseLinearDisplay.afterAttach) {
          // @ts-expect-error
          BaseLinearDisplay.afterAttach.call(self)
        }

        // Use reaction to continuously monitor for block changes
        addDisposer(
          self,
          reaction(
            // Track the set of block keys
            () => Array.from(self.blockState.keys()).sort().join(','),
            // When block keys change, restart monitoring
            (blockKeys, prevBlockKeys) => {
              if (blockKeys && blockKeys !== prevBlockKeys && self.blockState.size > 0) {
                console.log(
                  '[SubtrackFeatureDisplay] Block set changed, starting monitoring. Block count:',
                  self.blockState.size,
                )
                // Reset flag for new block set
                self.hasReloadedAfterRender = false
                self.startBlockMonitoring()
              }
            },
            {
              name: 'SubtrackFeatureDisplay-blockChangeMonitor',
              fireImmediately: true,
            },
          ),
        )
      },
    }))
}

export type SubtrackFeatureDisplayStateModel = ReturnType<
  typeof stateModelFactory
>
export type SubtrackFeatureDisplayModel = Instance<
  SubtrackFeatureDisplayStateModel
>
