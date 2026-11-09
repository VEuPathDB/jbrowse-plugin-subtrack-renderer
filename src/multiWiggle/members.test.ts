import { resetDuplicateWarnings } from '../resolveSubtracks'
import {
  filteredAdapterConfig,
  memberLabel,
  wiggleCatalog,
  wiggleMembers,
} from './members'

const bw = (uri: string, extra: Record<string, unknown> = {}) => ({
  type: 'BigWigAdapter',
  bigWigLocation: { uri, locationType: 'UriLocation' },
  ...extra,
})

const multi = (subadapters: Record<string, unknown>[]) => ({
  type: 'MultiWiggleAdapter',
  subadapters,
})

describe('memberLabel', () => {
  it('prefers source, then name, then the basename without extension', () => {
    expect(memberLabel(bw('a/s1.bw', { source: 'src', name: 'nm' }))).toBe(
      'src',
    )
    expect(memberLabel(bw('a/s1.bw', { name: 'nm' }))).toBe('nm')
    expect(memberLabel(bw('https://h/x/s1.bw?tok=1'))).toBe('s1')
  })
})

describe('wiggleMembers', () => {
  beforeEach(() => {
    resetDuplicateWarnings()
  })

  it('is empty for any other adapter', () => {
    expect(wiggleMembers({ type: 'BigWigAdapter' })).toEqual([])
    expect(wiggleMembers(undefined)).toEqual([])
  })

  it('stamps each subadapter with its label as source', () => {
    const members = wiggleMembers(
      multi([bw('s1.bw'), bw('s2.bw', { name: 'two' })]),
    )
    expect(members.map(m => m.label)).toEqual(['s1', 'two'])
    expect(members.map(m => m.conf.source)).toEqual(['s1', 'two'])
  })

  it('expands the bigWigs shorthand against baseUri', () => {
    const members = wiggleMembers({
      type: 'MultiWiggleAdapter',
      bigWigs: ['s1.bw', 's2.bw'],
      baseUri: 'http://h/data/',
    })
    expect(members.map(m => m.label)).toEqual(['s1', 's2'])
    expect(members[0]?.conf).toMatchObject({
      type: 'BigWigAdapter',
      bigWigLocation: { uri: 's1.bw', baseUri: 'http://h/data/' },
    })
  })

  it('drops a duplicate label, keeping the first', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const members = wiggleMembers(multi([bw('a/s1.bw'), bw('b/s1.bw')]))
    expect(members.map(m => m.conf.bigWigLocation)).toEqual([
      { uri: 'a/s1.bw', locationType: 'UriLocation' },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('wiggleCatalog', () => {
  const members = wiggleMembers(multi([bw('s1.bw'), bw('s2.bw'), bw('s3.bw')]))

  it('turns every subtrack on when no default is set', () => {
    expect(wiggleCatalog(members, undefined).every(l => l.visible)).toBe(true)
  })

  it('turns on only the defaults', () => {
    expect(
      wiggleCatalog(members, ['s3', 's1']).map(l => [l.label, l.visible]),
    ).toEqual([
      ['s1', true],
      ['s2', false],
      ['s3', true],
    ])
  })

  it('treats defaults naming no subtrack as unset, not as an empty track', () => {
    expect(wiggleCatalog(members, ['gone']).every(l => l.visible)).toBe(true)
  })
})

describe('filteredAdapterConfig', () => {
  const adapter = multi([bw('s1.bw'), bw('s2.bw'), bw('s3.bw')])
  const members = wiggleMembers(adapter)

  it('keeps only the chosen subadapters, in the chosen order', () => {
    const out = filteredAdapterConfig(adapter, members, ['s3', 's1'])
    expect(
      (out.subadapters as { source: string }[]).map(s => s.source),
    ).toEqual(['s3', 's1'])
  })

  it('gives each subset its own adapterId, replacing a configured one', () => {
    const withId = { ...adapter, adapterId: 'configured' }
    const a = filteredAdapterConfig(withId, members, ['s1', 's3'])
    const b = filteredAdapterConfig(withId, members, ['s2', 's3'])
    expect(a.adapterId).not.toBe('configured')
    expect(a.adapterId).not.toBe(b.adapterId)
    expect(filteredAdapterConfig(withId, members, ['s1', 's3']).adapterId).toBe(
      a.adapterId,
    )
  })

  it('returns the original object for every member in declared order', () => {
    expect(filteredAdapterConfig(adapter, members, ['s1', 's2', 's3'])).toBe(
      adapter,
    )
  })

  it('still filters when every member is chosen but reordered', () => {
    expect(
      filteredAdapterConfig(adapter, members, ['s2', 's1', 's3']),
    ).not.toBe(adapter)
  })

  it('never empties the adapter', () => {
    expect(filteredAdapterConfig(adapter, members, ['gone'])).toBe(adapter)
  })

  it('clears the bigWigs shorthand so it cannot re-add hidden files', () => {
    const shorthand = {
      type: 'MultiWiggleAdapter',
      bigWigs: ['s1.bw', 's2.bw'],
    }
    const out = filteredAdapterConfig(shorthand, wiggleMembers(shorthand), [
      's2',
    ])
    expect(out.bigWigs).toEqual([])
    expect((out.subadapters as unknown[]).length).toBe(1)
  })
})
