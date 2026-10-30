import HiddenGroupsMixin from '@jbrowse/display-kit/HiddenGroupsMixin'
import { types } from '@jbrowse/mobx-state-tree'

import installDisplayExtension from './index'

import type { MenuItem } from '@jbrowse/core/ui'
import type { IAnyModelType } from '@jbrowse/mobx-state-tree'

// The gate reads the track's `metadata.subtracks` catalog and the display's
// `facet.field` through core helpers that need a real session tree. Only those
// reads matter here, so they are stubbed rather than a whole runtime stood up.
let catalog: unknown[] = []
let facetField = ''
let facetHidden: string[] = []
let lastFacet: { field: string; sort?: readonly string[] } | undefined

// Spread the real modules: core's own internals import these same barrels, so
// replacing them wholesale breaks the package being tested.
jest.mock('@jbrowse/core/util', () => ({
  ...jest.requireActual('@jbrowse/core/util'),
  getContainingTrack: () => ({ fakeTrack: true }),
  getDialogHost: () => ({ queueDialog: () => {} }),
}))

jest.mock('@jbrowse/core/configuration', () => ({
  ...jest.requireActual('@jbrowse/core/configuration'),
  getConf: (_node: unknown, path: string | string[]) => {
    if (path === 'metadata') {
      return { subtracks: catalog }
    }
    if (Array.isArray(path) && path[0] === 'facet' && path[1] === 'field') {
      return facetField
    }
    if (Array.isArray(path) && path[0] === 'facet' && path[1] === 'hidden') {
      return facetHidden
    }
    return undefined
  },
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

  // `setFacet` is a real LinearBasicDisplay action; the stand-in records what
  // the extension writes so the sort can be asserted. The real
  // HiddenGroupsMixin is composed in because the extension overrides its
  // `hiddenGroupKeys`, which is what the canvas display actually reads.
  lastFacet = undefined
  const stand = types
    .model('TestBasicDisplay', {})
    .views(() => ({
      get groupKeySpace() {
        return facetField
      },
    }))
    .actions(() => ({
    trackMenuItems(): MenuItem[] {
      return BASE_MENU
    },
    setFacet(facet?: { field: string; sort?: readonly string[] }) {
      lastFacet = facet
    },
  }))
  const base = types.compose(HiddenGroupsMixin(), stand)

  return extend(base).create({}) as {
    trackMenuItems: () => MenuItem[]
    displayHiddenGroupKeys: ReadonlySet<string>
    hiddenGroupKeys: ReadonlySet<string>
    setSubtrackSelection: (labels: string[]) => void
  }
}

function labels(items: MenuItem[]) {
  return items.map(item => ('label' in item ? item.label : undefined))
}

test('a subtrack track trades "Group by..." for "Select subtracks..."', () => {
  catalog = [{ label: 'Genes' }]
  facetField = 'subtrack'
  const menu = labels(extendedDisplay().trackMenuItems())
  expect(menu).toContain('Select subtracks...')
  expect(menu).not.toContain('Group by...')
})

test('an ordinary track keeps "Group by..." and gains nothing', () => {
  catalog = []
  facetField = ''
  const menu = labels(extendedDisplay().trackMenuItems())
  expect(menu).toContain('Group by...')
  expect(menu).not.toContain('Select subtracks...')
})

test('a catalog without a facet field is not a subtrack track', () => {
  // Both halves are required: a catalog names lanes, the facet field is what
  // makes them sections. With no field there is nothing for the picker to
  // write a sort to, so the stock menu must survive untouched.
  catalog = [{ label: 'Genes' }]
  facetField = ''
  const menu = labels(extendedDisplay().trackMenuItems())
  expect(menu).toContain('Group by...')
  expect(menu).not.toContain('Select subtracks...')
})

describe('initial visibility', () => {
  beforeEach(() => {
    facetField = 'subtrack'
  })

  it("opens on the catalog's visible lanes, not on all of them", () => {
    // The case that matters at scale: a track declares hundreds of lanes and
    // means to open on a handful. An undefined selection is "not chosen yet",
    // which resolveSubtracks answers with the catalog's own defaults -- it is
    // NOT "show everything".
    catalog = [
      { label: 'a', visible: true },
      { label: 'b', visible: false },
      { label: 'c', visible: false },
    ]
    expect([...extendedDisplay().displayHiddenGroupKeys].sort()).toEqual([
      'b',
      'c',
    ])
  })

  it('hides nothing when every lane defaults visible', () => {
    catalog = [{ label: 'a' }, { label: 'b' }]
    expect(extendedDisplay().displayHiddenGroupKeys.size).toBe(0)
  })

  it("a reader's selection overrides the catalog defaults, both ways", () => {
    catalog = [
      { label: 'a', visible: true },
      { label: 'b', visible: false },
    ]
    const display = extendedDisplay()
    display.setSubtrackSelection(['b'])
    // 'b' was default-off and is now shown; 'a' was default-on and is now hidden
    expect([...display.displayHiddenGroupKeys]).toEqual(['a'])
  })

  it('writes the selection order to the facet sort', () => {
    // One reader action drives both halves: membership through the prop that
    // displayHiddenGroupKeys derives from, order through the facet's sort.
    catalog = [{ label: 'a' }, { label: 'b' }, { label: 'c' }]
    const display = extendedDisplay()
    display.setSubtrackSelection(['c', 'a'])
    expect(lastFacet).toEqual({ field: 'subtrack', sort: ['c', 'a'] })
    expect([...display.displayHiddenGroupKeys]).toEqual(['b'])
  })

  it('hides nothing on a track with no catalog', () => {
    catalog = []
    expect(extendedDisplay().displayHiddenGroupKeys.size).toBe(0)
  })
})

describe('the lanes the canvas display drops', () => {
  // beta.18 removed HiddenGroupsMixin's displayHiddenGroupKeys hook: its own
  // hiddenGroupKeys now reads only facet.hidden, so the catalog's default-off
  // lanes all showed. These pin the fold the extension restores.
  beforeEach(() => {
    facetField = 'subtrack'
    facetHidden = []
  })

  it("include the catalog's default-off lanes", () => {
    catalog = [
      { label: 'a', visible: true },
      { label: 'b', visible: false },
    ]
    expect([...extendedDisplay().hiddenGroupKeys]).toEqual(['b'])
  })

  it("include what the reader hid from a chip, beside the plugin's own", () => {
    catalog = [
      { label: 'a', visible: true },
      { label: 'b', visible: false },
      { label: 'c', visible: true },
    ]
    facetHidden = ['a']
    expect([...extendedDisplay().hiddenGroupKeys].sort()).toEqual(['a', 'b'])
  })

  it('are none when neither half hides anything', () => {
    catalog = [{ label: 'a' }]
    expect(extendedDisplay().hiddenGroupKeys.size).toBe(0)
  })
})
