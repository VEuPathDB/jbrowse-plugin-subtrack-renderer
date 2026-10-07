import { getConf } from '@jbrowse/core/configuration'
import { extendDisplayType } from '@jbrowse/core/pluggableElementTypes'
import { getContainingTrack, getContainingView } from '@jbrowse/core/util'
import { observer } from 'mobx-react'
import React, { createElement, lazy, Suspense } from 'react'

import '../displayExtension/registry'

import type PluginManager from '@jbrowse/core/PluginManager'
import type { PluggableElementType } from '@jbrowse/core/pluggableElementTypes'
import type { ComponentType } from 'react'
import type { MenuItem } from '@jbrowse/core/ui'
import type { IAnyModelType, IAnyStateTreeNode } from '@jbrowse/mobx-state-tree'

const SyntenyRibbonLayer = lazy(() => import('./SyntenyRibbonLayer'))

const ADAPTER = 'SyntenyRescaleAdapter'

function isSyntenyTrack(self: unknown): boolean {
  try {
    return (
      getConf(getContainingTrack(self as IAnyStateTreeNode), [
        'adapter',
        'type',
      ]) === ADAPTER
    )
  } catch {
    return false
  }
}

/**
 * Adds the ribbon overlay and the switch that shows it.
 *
 * Two halves, because `extendDisplayType` reaches the state model and nothing
 * else. The flag and the menu entry go on the model the supported way; the
 * layer has to be composed into the display's React component, and the only
 * route to that is the extension point `extendDisplayType` is itself built on —
 * the callback is handed the element and takes back what it returns, and
 * `DisplayType.ReactComponent` is a plain field.
 *
 * That second half is unsanctioned. It is one wrapper over a component the
 * display still owns, so the blast radius is this plugin, but a JBrowse that
 * restructures `FeatureComponent`'s layers will break it and the tests here
 * will not notice. See docs/facet-upstream-gaps.md.
 */
export default function installSyntenyRibbons(pluginManager: PluginManager) {
  extendDisplayType(pluginManager, 'LinearBasicDisplay', stateModel =>
    (stateModel as IAnyModelType)
      .props({ showsSyntenyRibbons: false })
      .actions(self => ({
        setShowsSyntenyRibbons(show: boolean) {
          self.showsSyntenyRibbons = show
        },
      }))
      .actions(self => {
        const superTrackMenuItems = self.trackMenuItems
        return {
          trackMenuItems() {
            const base = superTrackMenuItems() as MenuItem[]
            return isSyntenyTrack(self)
              ? [
                  ...base,
                  {
                    label: 'Shade orthologs',
                    type: 'checkbox' as const,
                    checked: self.showsSyntenyRibbons,
                    onClick: () => {
                      self.setShowsSyntenyRibbons(!self.showsSyntenyRibbons)
                    },
                  },
                ]
              : base
          },
        }
      }),
  )

  pluginManager.addToExtensionPoint(
    'Core-extendPluggableElement',
    (element: PluggableElementType) => {
      const display = element as unknown as {
        name?: string
        ReactComponent?: ComponentType<{ model: unknown }>
      }
      if (display.name !== 'LinearBasicDisplay' || !display.ReactComponent) {
        return element
      }
      const Inner = display.ReactComponent
      // A fragment, not a positioned wrapper: the display sizes its own box and
      // a div around it changes that box's layout.
      display.ReactComponent = observer(function WithSyntenyRibbons(props: {
        model: unknown
      }) {
        const model = props.model as {
          showsSyntenyRibbons?: boolean
        }
        return (
          <>
            {createElement(Inner, props)}
            {model.showsSyntenyRibbons ? (
              <Suspense fallback={null}>
                <SyntenyRibbonLayer
                  model={model as never}
                  view={
                    getContainingView(props.model as IAnyStateTreeNode) as never
                  }
                />
              </Suspense>
            ) : null}
          </>
        )
      })
      return element
    },
  )
}
