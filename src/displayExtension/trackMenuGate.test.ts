import { types } from '@jbrowse/mobx-state-tree'

import installDisplayExtension from './index'

import type { MenuItem } from '@jbrowse/core/ui'
import type { IAnyModelType } from '@jbrowse/mobx-state-tree'

// The gate reads the containing track's adapter type through core helpers that
// need a real session tree. Only these two reads matter here, so they are
// stubbed rather than a whole runtime stood up.
let adapterType = 'Gff3TabixAdapter'

// Spread the real modules: core's own internals import these same barrels, so
// replacing them wholesale breaks the package being tested.
jest.mock('@jbrowse/core/util', () => ({
  ...jest.requireActual('@jbrowse/core/util'),
  getContainingTrack: () => ({ fakeTrack: true }),
  getDialogHost: () => ({ queueDialog: () => {} }),
}))

jest.mock('@jbrowse/core/configuration', () => ({
  ...jest.requireActual('@jbrowse/core/configuration'),
  getConf: (_track: unknown, path: string[]) =>
    path[1] === 'type' ? adapterType : [],
}))

const BASE_MENU: MenuItem[] = [
  { label: 'Group by...', onClick: () => {} },
  { label: 'Force load', onClick: () => {} },
]

/**
 * `extendDisplayType` registers a callback on `Core-extendPluggableElement`;
 * this drives that callback by hand and applies the returned extension to a
 * stand-in base model carrying just the action the gate overrides.
 */
function extendedDisplay() {
  let extend: ((m: IAnyModelType) => IAnyModelType) | undefined
  const pluginManager = {
    addToExtensionPoint: (
      _name: string,
      cb: (element: unknown, props: { group: string }) => unknown,
    ) => {
      cb(
        {
          name: 'LinearBasicDisplay',
          extendStateModel: (fn: (m: IAnyModelType) => IAnyModelType) => {
            extend = fn
          },
        },
        { group: 'display' },
      )
    },
  }

  installDisplayExtension(pluginManager as never)
  if (!extend) {
    throw new Error('extendDisplayType never reached LinearBasicDisplay')
  }

  const base = types.model('TestBasicDisplay', {}).actions(() => ({
    trackMenuItems(): MenuItem[] {
      return BASE_MENU
    },
  }))

  return extend(base).create({}) as {
    trackMenuItems: () => MenuItem[]
  }
}

function labels(items: MenuItem[]) {
  return items.map(item => ('label' in item ? item.label : undefined))
}

test('a subtrack track trades "Group by..." for "Select subtracks..."', () => {
  adapterType = 'SubtrackAdapter'
  const menu = labels(extendedDisplay().trackMenuItems())
  expect(menu).toContain('Select subtracks...')
  expect(menu).not.toContain('Group by...')
})

test('an ordinary track keeps "Group by..." and gains nothing', () => {
  adapterType = 'Gff3TabixAdapter'
  const menu = labels(extendedDisplay().trackMenuItems())
  expect(menu).toContain('Group by...')
  expect(menu).not.toContain('Select subtracks...')
})
