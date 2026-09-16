import { decorateFeature } from './decorateFeature'

import type { Feature } from '@jbrowse/core/util'

function fakeFeature(data: Record<string, unknown>, id = 'f1'): Feature {
  return {
    get: (k: string) => data[k],
    id: () => id,
    toJSON: () => ({ uniqueId: id, ...data }),
  } as unknown as Feature
}

test('get("subtrack") answers the stamped lane', () => {
  const d = decorateFeature(fakeFeature({ type: 'intron' }), 'Introns')
  expect(d.get('subtrack')).toBe('Introns')
})

test('every other attribute delegates to the wrapped feature', () => {
  const d = decorateFeature(
    fakeFeature({ type: 'intron', start: 5 }),
    'Introns',
  )
  expect(d.get('type')).toBe('intron')
  expect(d.get('start')).toBe(5)
  expect(d.get('nope')).toBeUndefined()
})

test('identity is preserved, so hit-testing and details still resolve', () => {
  const d = decorateFeature(fakeFeature({}, 'abc'), 'Introns')
  expect(d.id()).toBe('abc')
})

test('toJSON carries the stamp, so it survives serialization', () => {
  const d = decorateFeature(fakeFeature({ type: 'intron' }), 'Introns')
  expect(d.toJSON()).toMatchObject({ type: 'intron', subtrack: 'Introns' })
})
