import { getSnapshot, types } from '@jbrowse/mobx-state-tree'

import { resetDuplicateWarnings } from '../resolveSubtracks'
import installWiggleExtension from './wiggle'

import type { MenuItem } from '@jbrowse/core/ui'
import type { IAnyModelType } from '@jbrowse/mobx-state-tree'

let adapter: Record<string, unknown> = {}
let metadata: Record<string, unknown> = {}

jest.mock('@jbrowse/core/util', () => ({
  ...jest.requireActual('@jbrowse/core/util'),
  getContainingTrack: () => ({ fakeTrack: true }),
  getDialogHost: () => ({ queueDialog: () => {} }),
}))

jest.mock('@jbrowse/core/configuration', () => ({
  ...jest.requireActual('@jbrowse/core/configuration'),
  getConf: (_node: unknown, path: string) =>
    path === 'adapter' ? adapter : path === 'metadata' ? metadata : undefined,
}))

const BASE_MENU: MenuItem[] = [
  { label: 'Edit colors/arrangement...', onClick: () => {} },
]

interface WiggleDisplay {
  trackMenuItems: () => MenuItem[]
  adapterConfig: Record<string, unknown>
  subtrackCatalog: { label: string; visible?: boolean }[]
  setSubtrackSelection: (labels: string[]) => void
  resetSubtrackSelection: () => void
}

function extendedModel() {
  let extend: ((m: IAnyModelType) => IAnyModelType) | undefined
  installWiggleExtension({
    addToExtensionPoint: (
      _name: string,
      cb: (element: unknown, props: { group: string }) => unknown,
    ) => {
      cb(
        {
          name: 'LinearWiggleDisplay',
          extendStateModel: (fn: (m: IAnyModelType) => IAnyModelType) => {
            extend = fn
          },
        },
        { group: 'display' },
      )
    },
  } as never)
  if (!extend) {
    throw new Error('extendDisplayType never reached LinearWiggleDisplay')
  }
  return extend(
    types.model('TestWiggleDisplay', {}).actions(() => ({
      trackMenuItems: () => BASE_MENU,
      clearAllRpcData: () => {
        clears++
      },
    })),
  )
}

let clears = 0

const display = (snap = {}) =>
  extendedModel().create(snap) as unknown as WiggleDisplay

const sources = (d: WiggleDisplay) =>
  ((d.adapterConfig.subadapters ?? []) as { source: string }[]).map(
    s => s.source,
  )

function useMulti(n: number) {
  adapter = {
    type: 'MultiWiggleAdapter',
    subadapters: Array.from({ length: n }, (_, i) => ({
      type: 'BigWigAdapter',
      bigWigLocation: { uri: `s${i + 1}.bw`, locationType: 'UriLocation' },
    })),
  }
}

beforeEach(() => {
  resetDuplicateWarnings()
  metadata = {}
  useMulti(4)
})

const labels = (items: MenuItem[]) =>
  items.map(i => ('label' in i ? i.label : undefined))

describe('the menu', () => {
  it('adds "Select subtracks..." to a multi-wiggle track', () => {
    expect(labels(display().trackMenuItems())).toEqual([
      'Edit colors/arrangement...',
      'Select subtracks...',
    ])
  })

  it('leaves a single bigwig alone', () => {
    adapter = { type: 'BigWigAdapter', bigWigLocation: { uri: 'one.bw' } }
    expect(labels(display().trackMenuItems())).toEqual([
      'Edit colors/arrangement...',
    ])
  })

  it('lists the subadapters by name', () => {
    expect(display().subtrackCatalog.map(l => l.label)).toEqual([
      's1',
      's2',
      's3',
      's4',
    ])
  })
})

describe('what the worker is asked to fetch', () => {
  it('is the unchanged adapter config without defaults or a selection', () => {
    expect(display().adapterConfig).toBe(adapter)
  })

  it("is only the track's defaultSubtracks before the reader chooses", () => {
    metadata = { defaultSubtracks: ['s2', 's4'] }
    expect(sources(display())).toEqual(['s2', 's4'])
  })

  it("is only the reader's selection, in the reader's order", () => {
    metadata = { defaultSubtracks: ['s2'] }
    const d = display()
    d.setSubtrackSelection(['s4', 's1'])
    expect(sources(d)).toEqual(['s4', 's1'])
  })

  it('goes back to the defaults on reset', () => {
    metadata = { defaultSubtracks: ['s3'] }
    const d = display()
    d.setSubtrackSelection(['s1'])
    d.resetSubtrackSelection()
    expect(sources(d)).toEqual(['s3'])
  })

  it('drops held data on every selection change, so no stale row list is re-sent', () => {
    const d = display()
    clears = 0
    d.setSubtrackSelection(['s2'])
    d.resetSubtrackSelection()
    expect(clears).toBe(2)
  })

  it('drops a selected name the config no longer has', () => {
    const d = display()
    d.setSubtrackSelection(['s9', 's2'])
    expect(sources(d)).toEqual(['s2'])
  })
})

describe('a saved session', () => {
  it('restores the selection and its order', () => {
    const d = display()
    d.setSubtrackSelection(['s3', 's1'])
    const restored = display(getSnapshot(d as never))
    expect(sources(restored)).toEqual(['s3', 's1'])
  })
})
