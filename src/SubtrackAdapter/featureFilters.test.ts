import { matchesFilters } from './featureFilters'

const feat = (data: Record<string, unknown>) => ({
  get: (k: string) => data[k],
})

test('empty filters match everything', () => {
  expect(matchesFilters(feat({ type: 'gene' }), {})).toBe(true)
})

test('all criteria must match', () => {
  const f = feat({ type: 'gene', source: 'interpro' })
  expect(matchesFilters(f, { type: 'gene' })).toBe(true)
  expect(matchesFilters(f, { type: 'gene', source: 'interpro' })).toBe(true)
  expect(matchesFilters(f, { type: 'gene', source: 'other' })).toBe(false)
})

test('a missing attribute never matches', () => {
  expect(matchesFilters(feat({ type: 'gene' }), { source: 'x' })).toBe(false)
})

test('values compare as strings, so 5 and "5" agree', () => {
  expect(matchesFilters(feat({ n: 5 }), { n: '5' })).toBe(true)
  expect(matchesFilters(feat({ n: '5' }), { n: 5 })).toBe(true)
})

test('range filters are half-open: min inclusive, max exclusive', () => {
  const r = { score: { min: 10, max: 50 } }
  expect(matchesFilters(feat({ score: 10 }), r)).toBe(true)
  expect(matchesFilters(feat({ score: 49.9 }), r)).toBe(true)
  expect(matchesFilters(feat({ score: 50 }), r)).toBe(false)
  expect(matchesFilters(feat({ score: 9.9 }), r)).toBe(false)
})

test('a non-numeric value never satisfies a range', () => {
  expect(matchesFilters(feat({ score: 'high' }), { score: { min: 0, max: 9 } })).toBe(false)
  expect(matchesFilters(feat({}), { score: { min: 0, max: 9 } })).toBe(false)
})
