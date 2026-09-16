import { laneKeyFor } from './laneKey'

import type { Lane } from './laneKey'

const feat = (data: Record<string, unknown>) => ({
  get: (k: string) => data[k],
})

const LANES: Lane[] = [
  { label: 'Introns', featureFilters: { type: 'intron' } },
  { label: 'Domains', featureFilters: { source: 'interpro' } },
]

test('returns the label of the matching lane', () => {
  expect(laneKeyFor(feat({ type: 'intron' }), LANES)).toBe('Introns')
  expect(laneKeyFor(feat({ source: 'interpro' }), LANES)).toBe('Domains')
})

test('first match wins, so lane order is filter precedence', () => {
  const overlapping: Lane[] = [
    { label: 'First', featureFilters: { type: 'gene' } },
    { label: 'Second', featureFilters: { type: 'gene' } },
  ]
  expect(laneKeyFor(feat({ type: 'gene' }), overlapping)).toBe('First')
})

test('no match returns undefined, which becomes the catch-all section', () => {
  expect(laneKeyFor(feat({ type: 'exon' }), LANES)).toBeUndefined()
})

test('an empty lane list matches nothing', () => {
  expect(laneKeyFor(feat({ type: 'intron' }), [])).toBeUndefined()
})

test('a lane with empty filters is a catch-all and swallows the rest', () => {
  const withCatchAll: Lane[] = [
    { label: 'Introns', featureFilters: { type: 'intron' } },
    { label: 'Everything else', featureFilters: {} },
  ]
  expect(laneKeyFor(feat({ type: 'exon' }), withCatchAll)).toBe('Everything else')
  expect(laneKeyFor(feat({ type: 'intron' }), withCatchAll)).toBe('Introns')
})
