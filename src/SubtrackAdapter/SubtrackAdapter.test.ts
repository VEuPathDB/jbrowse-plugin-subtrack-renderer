import { firstValueFrom, of, toArray } from 'rxjs'

import SubtrackAdapter from './SubtrackAdapter'

import type { BaseFeatureDataAdapter } from '@jbrowse/core/data_adapters/BaseAdapter'
import type { Feature, Region } from '@jbrowse/core/util'

const LANES = [
  { label: 'Introns', featureFilters: { type: 'intron' } },
  { label: 'Domains', featureFilters: { source: 'interpro' } },
]

function fakeFeature(data: Record<string, unknown>, id: string): Feature {
  return {
    get: (k: string) => data[k],
    id: () => id,
    toJSON: () => ({ uniqueId: id, ...data }),
  } as unknown as Feature
}

const SUB_FEATURES = [
  fakeFeature({ type: 'intron' }, 'a'),
  fakeFeature({ source: 'interpro' }, 'b'),
  fakeFeature({ type: 'exon' }, 'c'),
]

const REGION = {
  refName: 'ctgA',
  start: 0,
  end: 100,
  assemblyName: 'volvox',
} as Region

type AdapterArgs = ConstructorParameters<typeof SubtrackAdapter>

function makeAdapter() {
  const subAdapter = {
    getRefNames: () => Promise.resolve(['ctgA', 'ctgB']),
    getFeatures: () => of(...SUB_FEATURES),
  } as unknown as BaseFeatureDataAdapter

  const adapter = new SubtrackAdapter(
    { lanes: LANES } as unknown as AdapterArgs[0],
    (() =>
      Promise.resolve({
        dataAdapter: subAdapter,
      })) as unknown as AdapterArgs[1],
    undefined,
  )
  // getConf is a config-model read; stub it for the plain object above
  Object.assign(adapter, {
    getConf: (slot: string) =>
      slot === 'lanes' ? LANES : { type: 'FakeAdapter' },
  })
  return adapter
}

test('getRefNames delegates to the sub-adapter', async () => {
  await expect(makeAdapter().getRefNames()).resolves.toEqual(['ctgA', 'ctgB'])
})

test('each feature is stamped with its lane', async () => {
  const feats = await firstValueFrom(
    makeAdapter().getFeatures(REGION).pipe(toArray()),
  )
  expect(feats.map(f => f.get('subtrack'))).toEqual([
    'Introns',
    'Domains',
    undefined,
  ])
})

test('every feature is emitted, including unmatched ones', async () => {
  const feats = await firstValueFrom(
    makeAdapter().getFeatures(REGION).pipe(toArray()),
  )
  expect(feats).toHaveLength(3)
  expect(feats.map(f => f.id())).toEqual(['a', 'b', 'c'])
})
