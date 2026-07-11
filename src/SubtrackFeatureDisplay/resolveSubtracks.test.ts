import {
  dedupeCatalog,
  resetDuplicateWarnings,
  resolveSubtracks,
} from './resolveSubtracks'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  { label: 'Genes', featureFilters: { type: 'gene' }, visible: true },
  { label: 'Matches', featureFilters: { type: 'match' }, visible: false },
  { label: 'Repeats', featureFilters: { type: 'repeat' }, visible: true },
]

// the warn-once throttle is module state, so it leaks between tests
beforeEach(() => {
  resetDuplicateWarnings()
})

describe('dedupeCatalog', () => {
  it('keeps the first entry for a duplicated label and warns', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const dupes: Subtrack[] = [
      { label: 'Genes', featureFilters: { type: 'gene' }, visible: true },
      { label: 'Genes', featureFilters: { type: 'other' }, visible: true },
    ]

    const result = dedupeCatalog(dupes)

    expect(result).toHaveLength(1)
    expect(result[0]!.featureFilters).toEqual({ type: 'gene' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Genes'))
    warn.mockRestore()
  })

  it('does not warn when labels are unique', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(dedupeCatalog(CATALOG)).toHaveLength(3)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('names a thrice-repeated label only once in the warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const triple: Subtrack[] = [
      { label: 'Genes', featureFilters: { type: 'gene' }, visible: true },
      { label: 'Genes', featureFilters: { type: 'other' }, visible: true },
      { label: 'Genes', featureFilters: { type: 'third' }, visible: true },
    ]

    const result = dedupeCatalog(triple)

    expect(result).toHaveLength(1)
    expect(result[0]!.featureFilters).toEqual({ type: 'gene' })
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0]![0] as string
    expect(message.match(/Genes/g)).toHaveLength(1)
    warn.mockRestore()
  })

  it('warns once across recomputes handed an equivalent but fresh array', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    // readConfObject structuredClones the catalog, so each recompute delivers a
    // new array reference with identical content -- an identity-keyed cache
    // would miss and warn twice here
    const build = (): Subtrack[] => [
      { label: 'Genes', featureFilters: { type: 'gene' }, visible: true },
      { label: 'Genes', featureFilters: { type: 'other' }, visible: true },
    ]

    dedupeCatalog(build())
    dedupeCatalog(build())

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('resolveSubtracks', () => {
  it('falls back to catalog defaults when there is no selection', () => {
    const result = resolveSubtracks(CATALOG, undefined)

    // Matches is visible:false, so it is off by default
    expect(result.map(s => s.label)).toEqual(['Genes', 'Repeats'])
  })

  it('honours the selection order, not the catalog order', () => {
    const result = resolveSubtracks(CATALOG, ['Repeats', 'Genes'])

    expect(result.map(s => s.label)).toEqual(['Repeats', 'Genes'])
  })

  it('can turn on a subtrack that is default-off, normalising visible', () => {
    const result = resolveSubtracks(CATALOG, ['Matches'])

    expect(result.map(s => s.label)).toEqual(['Matches'])
    expect(result[0]!.visible).toBe(true)
  })

  it('drops selected labels that are no longer in the catalog', () => {
    const result = resolveSubtracks(CATALOG, ['Genes', 'Retired', 'Repeats'])

    expect(result.map(s => s.label)).toEqual(['Genes', 'Repeats'])
  })

  it('drops a label repeated within the selection', () => {
    const result = resolveSubtracks(CATALOG, ['Genes', 'Genes'])

    expect(result.map(s => s.label)).toEqual(['Genes'])
  })

  it('returns nothing for an empty selection', () => {
    expect(resolveSubtracks(CATALOG, [])).toEqual([])
  })

  it('returns nothing and does not warn for an empty catalog', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveSubtracks([], undefined)).toEqual([])
    expect(resolveSubtracks([], ['x'])).toEqual([])
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })
})
