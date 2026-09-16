# Subtracks on JBrowse 5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render VEuPathDB subtracks as stacked lanes on stock JBrowse 5, by stamping a `subtrack` attribute onto features in a wrapping adapter and letting `LinearBasicDisplay.groupBy` do the lane rendering it already does.

**Architecture:** A `SubtrackAdapter` wraps a configured sub-adapter and decorates each feature with a `subtrack` attribute — the label of the first lane whose filter matches. Stock `LinearBasicDisplay` is then configured with `groupBy: {type:'attribute', attribute:'subtrack'}`, which gives stacked labelled sections, glyphs, per-section row packing and show/hide for free. A faceted selector dialog, reached by extending the display's state model, writes `hiddenGroupKeys`. No fork of jbrowse-components.

**Tech Stack:** TypeScript 5.9, JBrowse 5.0.0-beta.8 (`@jbrowse/core`), rollup UMD bundle, jest + jsdom, MUI 9 (host copy at runtime), pnpm 11, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-16-subtrack-v5-design.md`

---

## File Structure

**Created in this repo:**

| File | Responsibility |
| --- | --- |
| `src/SubtrackAdapter/featureFilters.ts` | Pure predicate: does a feature match one lane's `featureFilters`? |
| `src/SubtrackAdapter/laneKey.ts` | Pure: given lanes + feature, which lane label (or `undefined`)? |
| `src/SubtrackAdapter/decorateFeature.ts` | Pure: wrap a `Feature` so `get('subtrack')` answers |
| `src/SubtrackAdapter/SubtrackAdapter.ts` | The adapter: delegates to sub-adapter, decorates the stream |
| `src/SubtrackAdapter/configSchema.ts` | `subadapter` + `lanes` config slots |
| `src/SubtrackAdapter/index.ts` | `addAdapterType` registration |
| `src/resolveSubtracks.ts` | **Salvaged verbatim** from `init-dev` |
| `src/SubtrackSelector/*` | **Salvaged** from `init-dev`, MUI audited |
| `src/displayExtension/registry.d.ts` | `DisplayTypeRegistry` augmentation for `LinearBasicDisplay` |
| `src/displayExtension/index.ts` | `extendDisplayType` — menu item, dialog, `hiddenGroupKeys` |
| `src/index.ts` | Plugin class, `install()` only |

**Boundary that matters:** everything in `featureFilters.ts`, `laneKey.ts` and `resolveSubtracks.ts` is pure and JBrowse-free, so it is unit-testable without a JBrowse runtime. The adapter and the display extension are thin shells over them. Keep it that way — it is why the v4 logic survived the rewrite at all.

---

## Task 1: Stand up a stock v5 build to develop against

No TDD — this is environment setup. Nothing after this task can be verified without it.

**Files:**
- Create: `/home/jbrestel/jbrowse2/jb-v5` (git worktree, not a clone)

The existing `jbrowse-components` checkout sits on a v4-era branch with untracked files. Leave it alone; a worktree gives a second working directory off the same object store with no re-fetch.

- [ ] **Step 1: Create the worktree at upstream main**

```bash
cd /home/jbrestel/jbrowse2/jbrowse-components
git worktree add /home/jbrestel/jbrowse2/jb-v5 origin/main
```

Expected: `Preparing worktree (detached HEAD ...)` then a checkout at `v5.0.0-beta.8`.

- [ ] **Step 2: Confirm you are on v5, not v4**

```bash
cd /home/jbrestel/jbrowse2/jb-v5
git describe --tags
grep '"version"' packages/core/package.json | head -1
test -d packages/render-core && echo "render-core present: v5 confirmed"
```

Expected: a `v5.0.0-beta.8`-based describe, `"version": "5.0.0-beta.8"`, and `render-core present: v5 confirmed`.
If `packages/render-core` is missing you are on v4 — stop and re-check the worktree ref.

- [ ] **Step 3: Select the toolchain**

v5 declares `packageManager: pnpm@11.18.0`. The system pnpm is 10.34.5, so corepack must supply 11.

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22
corepack enable
cd /home/jbrestel/jbrowse2/jb-v5 && corepack pnpm -v
```

Expected: `11.18.0`. Every later command in this task uses `corepack pnpm`, not bare `pnpm`.

Do **not** change the global nvm default — Node 20 is the default deliberately, because JBrowse 1 needs the old runtime.

- [ ] **Step 4: Install**

```bash
cd /home/jbrestel/jbrowse2/jb-v5 && corepack pnpm install --frozen-lockfile
```

Expected: completes in roughly 4-8 minutes. Warnings about `products/jbrowse-img` wanting Node >=23 are expected and safe — we do not build it.

- [ ] **Step 5: Start the dev server and confirm it renders**

```bash
cd /home/jbrestel/jbrowse2/jb-v5/products/jbrowse-web && corepack pnpm start
```

Then open:
`http://localhost:3000/?config=test_data/volvox/config.json&loc=ctgA:1-20000&assembly=volvox&tracks=volvox_filtered_vcf`

Expected: the volvox dataset loads with no console errors.
Note `test_data/config.json` (without `volvox/`) is a **different** config pointing at remote hg19/hg38 data; using it with `assembly=volvox` yields "Assembly volvox not found".

- [ ] **Step 6: Prove the feature we are building on actually works before building on it**

This is the load-bearing assumption of the whole plan: that `groupBy` gives stacked labelled sections. Verify it by hand before writing any code.

In the running app, open a gene track's track menu and look for a **"Group by..."** submenu with a **Strand** option. Select it.

Expected: features restack into two labelled sections, "Forward strand" and "Reverse strand", each packing its own rows, with a chip label above each.

If this does not work, **stop and report** — the spec's central premise is wrong and the plan needs revisiting.

- [ ] **Step 7: Record what you verified**

```bash
cd /home/jbrestel/jbrowse2/jbrowse-plugin-subtrack-renderer
cat >> docs/superpowers/plans/2026-09-16-subtracks-v5.md <<'EOF'

## Verified environment

- v5 worktree: `/home/jbrestel/jb-v5` at `v5.0.0-beta.8`
- Toolchain: Node 22 + corepack pnpm 11.18.0
- `groupBy: strand` confirmed working by hand in jbrowse-web
EOF
git commit -am "docs: record verified v5 dev environment"
```

---

## Task 2: Plugin scaffolding on v5 dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `jest.config.js`, `rollup.config.js`, `.gitignore`

The `init-dev` scaffolding is a starting point but its dependency set is pinned to core 4.3.0 and MUI 7. Bring the files across, then repin.

- [ ] **Step 1: Bring the scaffolding across from init-dev**

```bash
cd /home/jbrestel/jbrowse2/jbrowse-plugin-subtrack-renderer
git checkout init-dev -- package.json tsconfig.json jest.config.js rollup.config.js .gitignore
```

- [ ] **Step 2: Find out what published core 5 actually declares**

Per the hard-won rule in `CLAUDE.md`: pin to what the **published** package declares, not to what the local monorepo tree says. Getting this wrong installs a second nested copy of a shared package and breaks module augmentation with errors that never mention duplication.

```bash
npm view @jbrowse/core@5.0.0-beta.8 dependencies
npm view @jbrowse/core@5.0.0-beta.8 peerDependencies
```

Recorded on 2026-09-16 against `@jbrowse/core@5.0.0-beta.8`. **Re-run the commands and prefer what they report** — this table is a convenience, not a source of truth:

| Package | init-dev (v4) | core 5.0.0-beta.8 |
| --- | --- | --- |
| `@mui/material`, `@mui/system` | `^7.3.11` | **`^9.4.0`** |
| `@mui/x-data-grid` | `^8.28.2` | **`^9.13.0`** |
| `@jbrowse/mobx-state-tree` | `^5.10.2` | **`^6.5.1`** |
| `mobx` | `^6.15.4` | **`^7.0.3`** |
| `mobx-react` | `^9.2.2` | **`^10.0.2`** |
| `react` / `react-dom` (peer) | `>=18.0.0` | **`>=19.0.0`** |

Four of those are **major** bumps, not just MUI. `@jbrowse/mobx-state-tree` and `@mui/material` are the two whose types cross the plugin boundary, so a second copy of either is not a duplicate-install nit — upstream measured this on the Apollo plugin: misaligned deps produced **~500 type errors, none of which named duplication as the cause**. MST reports `[$type]` missing from every `types.model` argument; MUI reports palette members missing. Step 4 is what catches it.

- [ ] **Step 3: Repin dependencies**

Edit `package.json`:
- `peerDependencies`: `@jbrowse/core` → `^5.0.0-beta.8`
- `devDependencies`: `@jbrowse/core`, `@jbrowse/cli` → `^5.0.0-beta.8`
- `@mui/material`, `@mui/system` → whatever Step 2 reported (expected MUI 9, **not** the `^7.3.11` init-dev pins)
- **Add** `@jbrowse/plugin-canvas` at `^5.0.0-beta.8` as a **devDependency** — needed only for `import type`, which is erased at compile time and never reaches the bundle
- **Remove** `g2p_mapper` — the peptide/CDS chain is deleted per the spec
- **Remove** `@jbrowse/plugin-linear-genome-view` unless a type import needs it

- [ ] **Step 4: Install and verify exactly one copy of each shared package**

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22
cd /home/jbrestel/jbrowse2/jbrowse-plugin-subtrack-renderer && pnpm install
find node_modules/.pnpm -maxdepth 1 -name "@mui+material@*"
find node_modules/.pnpm -maxdepth 1 -name "react@*"
```

Expected: **exactly one** directory from each `find`. Two means the pin is wrong — fix it now. A duplicate `@mui/material` breaks core's `declare module '@mui/material/styles'` palette augmentation, and the resulting type errors do not mention duplication.

- [ ] **Step 5: Confirm typecheck runs on an empty source tree**

```bash
mkdir -p src && echo 'export {}' > src/index.ts
pnpm typecheck
```

Expected: exits 0.

**That check is vacuous on its own** — an empty file typechecks no matter how
broken module resolution is. Prove resolution actually works by typechecking a
file that imports core for real:

```bash
cat > /tmp/resolve-probe.ts <<'EOF'
import Plugin from '@jbrowse/core/Plugin'
import { ConfigurationSchema } from '@jbrowse/core/configuration'
export { Plugin, ConfigurationSchema }
EOF
cp /tmp/resolve-probe.ts src/probe.ts && pnpm typecheck; rm src/probe.ts
```

Expected: exits 0. `TS2307: Cannot find module '@jbrowse/core/Plugin'` means
`moduleResolution` is wrong — core 5 publishes 234 subpaths through an
`exports` map, and Node10 resolution does not read `exports` at all. It must be
`"bundler"`. rollup externalises those specifiers regardless, so the bundle
still builds; you get a plugin with no types and no warning.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "build: scaffolding pinned to JBrowse 5.0.0-beta.8"
```

---

## Task 3: Feature filter matching

The predicate deciding whether one feature belongs in one lane. Pure, no JBrowse imports.

Semantics carried from v4 `featureMatchesSubtrack`: every entry in `featureFilters` must match. Values compare by `String()` equality, except `{min,max}` objects which are **half-open** numeric ranges (`min <= v < max`).

**Files:**
- Create: `src/SubtrackAdapter/featureFilters.ts`
- Test: `src/SubtrackAdapter/featureFilters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm test src/SubtrackAdapter/featureFilters.test.ts
```

Expected: FAIL — `Cannot find module './featureFilters.ts'`.

- [ ] **Step 3: Implement**

```typescript
/** A lane's filter set: every entry must match for the feature to belong. */
export type FeatureFilters = Record<string, unknown>

interface RangeFilter {
  min: number
  max: number
}

function isRangeFilter(v: unknown): v is RangeFilter {
  return (
    typeof v === 'object' &&
    v !== null &&
    'min' in v &&
    'max' in v &&
    typeof (v as RangeFilter).min === 'number' &&
    typeof (v as RangeFilter).max === 'number'
  )
}

interface FeatureLike {
  get: (name: string) => unknown
}

export function matchesFilters(
  feature: FeatureLike,
  filters: FeatureFilters,
): boolean {
  for (const [key, want] of Object.entries(filters)) {
    const got = feature.get(key)
    if (isRangeFilter(want)) {
      if (typeof got !== 'number' || got < want.min || got >= want.max) {
        return false
      }
    } else if (got === undefined || String(got) !== String(want)) {
      return false
    }
  }
  return true
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm test src/SubtrackAdapter/featureFilters.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackAdapter/featureFilters.ts src/SubtrackAdapter/featureFilters.test.ts
git commit -m "feat: feature filter matching for lane membership"
```

---

## Task 4: Lane key resolution

Which lane a feature lands in. First match wins, so lane order is also filter precedence.

**Files:**
- Create: `src/SubtrackAdapter/laneKey.ts`
- Test: `src/SubtrackAdapter/laneKey.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm test src/SubtrackAdapter/laneKey.test.ts
```

Expected: FAIL — `Cannot find module './laneKey.ts'`.

- [ ] **Step 3: Implement**

```typescript
import { matchesFilters } from './featureFilters'

import type { FeatureFilters } from './featureFilters'

/**
 * One lane. `label` is the lane's identity: it is the value stamped onto each
 * feature, the key `hiddenGroupKeys` hides by, and the row id in the selector.
 * `metadata` is what the selector facets on; nothing in rendering reads it.
 */
export interface Lane {
  label: string
  featureFilters: FeatureFilters
  metadata?: Record<string, string>
  visible?: boolean
}

interface FeatureLike {
  get: (name: string) => unknown
}

/**
 * The lane a feature belongs to, or undefined for none — which leaves the
 * feature unstamped, and so in the `''` catch-all section downstream.
 * First match wins: lane order is filter precedence.
 */
export function laneKeyFor(
  feature: FeatureLike,
  lanes: readonly Lane[],
): string | undefined {
  return lanes.find(lane => matchesFilters(feature, lane.featureFilters))?.label
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm test src/SubtrackAdapter/laneKey.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackAdapter/laneKey.ts src/SubtrackAdapter/laneKey.test.ts
git commit -m "feat: lane key resolution, first match wins"
```

---

## Task 5: Feature decoration

Wrap a `Feature` so `get('subtrack')` answers, delegating everything else. A wrapper rather than a rebuilt `SimpleFeature`, because rebuilding would drop subfeatures and parent handles.

**Files:**
- Create: `src/SubtrackAdapter/decorateFeature.ts`
- Test: `src/SubtrackAdapter/decorateFeature.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
  const d = decorateFeature(fakeFeature({ type: 'intron', start: 5 }), 'Introns')
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm test src/SubtrackAdapter/decorateFeature.test.ts
```

Expected: FAIL — `Cannot find module './decorateFeature.ts'`.

- [ ] **Step 3: Implement**

```typescript
import type { Feature } from '@jbrowse/core/util'

/** The attribute name the display's `groupBy` partitions on. */
export const SUBTRACK_ATTR = 'subtrack'

/**
 * A feature that also answers `get('subtrack')`. Delegation rather than a
 * rebuilt SimpleFeature: rebuilding drops subfeatures and the parent handle,
 * which the gene glyph path needs.
 */
export function decorateFeature(feature: Feature, lane: string): Feature {
  return {
    ...feature,
    get: (name: string) => (name === SUBTRACK_ATTR ? lane : feature.get(name)),
    id: () => feature.id(),
    parent: () => feature.parent?.(),
    children: () => feature.children?.(),
    toJSON: () => ({ ...feature.toJSON(), [SUBTRACK_ATTR]: lane }),
  } as unknown as Feature
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm test src/SubtrackAdapter/decorateFeature.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackAdapter/decorateFeature.ts src/SubtrackAdapter/decorateFeature.test.ts
git commit -m "feat: feature decoration stamping the subtrack attribute"
```

---

## Task 6: The adapter

**Files:**
- Create: `src/SubtrackAdapter/configSchema.ts`, `src/SubtrackAdapter/SubtrackAdapter.ts`, `src/SubtrackAdapter/index.ts`
- Test: `src/SubtrackAdapter/SubtrackAdapter.test.ts`

- [ ] **Step 1: Write the config schema**

```typescript
import { ConfigurationSchema } from '@jbrowse/core/configuration'

/**
 * #config SubtrackAdapter
 * Wraps another adapter and stamps each feature with the label of the first
 * lane whose filters it matches, for `LinearBasicDisplay` to group on.
 */
export default ConfigurationSchema(
  'SubtrackAdapter',
  {
    /**
     * #slot
     * The lanes, in stacking order. Order is also filter precedence: the first
     * lane whose filters match claims the feature.
     */
    lanes: {
      type: 'frozen',
      defaultValue: [],
      description:
        'array of {label, featureFilters, metadata?} in stacking order; first match wins',
    },
    /**
     * #slot
     * The adapter supplying the features.
     */
    subadapter: {
      type: 'frozen',
      defaultValue: null,
      description: 'the adapter whose features get stamped with a lane',
    },
  },
  { explicitlyTyped: true },
)
```

- [ ] **Step 2: Write the failing adapter test**

```typescript
import { firstValueFrom, toArray } from 'rxjs'

import SubtrackAdapter from './SubtrackAdapter'

import type { Feature } from '@jbrowse/core/util'

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

const REGION = { refName: 'ctgA', start: 0, end: 100, assemblyName: 'volvox' }

function makeAdapter() {
  const subAdapter = {
    getRefNames: async () => ['ctgA', 'ctgB'],
    getFeatures: () => ({
      subscribe: (obs: any) => {
        SUB_FEATURES.forEach(f => { obs.next(f) })
        obs.complete()
        return { unsubscribe() {} }
      },
    }),
  }
  const adapter = new SubtrackAdapter(
    { lanes: LANES } as any,
    async () => ({ dataAdapter: subAdapter }) as any,
    undefined,
  )
  // getConf is a config-model read; stub it for the plain object above
  ;(adapter as any).getConf = (slot: string) =>
    slot === 'lanes' ? LANES : undefined
  return adapter
}

test('getRefNames delegates to the sub-adapter', async () => {
  await expect(makeAdapter().getRefNames()).resolves.toEqual(['ctgA', 'ctgB'])
})

test('each feature is stamped with its lane', async () => {
  const feats = await firstValueFrom(
    makeAdapter().getFeatures(REGION as any).pipe(toArray()),
  )
  expect(feats.map(f => f.get('subtrack'))).toEqual([
    'Introns',
    'Domains',
    undefined,
  ])
})

test('every feature is emitted, including unmatched ones', async () => {
  const feats = await firstValueFrom(
    makeAdapter().getFeatures(REGION as any).pipe(toArray()),
  )
  expect(feats).toHaveLength(3)
  expect(feats.map(f => f.id())).toEqual(['a', 'b', 'c'])
})
```

Note the last test: unmatched features are **emitted, not filtered**. Dropping them would make lane selection change the data rather than the view.

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm test src/SubtrackAdapter/SubtrackAdapter.test.ts
```

Expected: FAIL — `Cannot find module './SubtrackAdapter.ts'`.

- [ ] **Step 4: Implement the adapter**

```typescript
import { BaseFeatureDataAdapter } from '@jbrowse/core/data_adapters/BaseAdapter'
import { ObservableCreate } from '@jbrowse/core/util/rxjs'

import { decorateFeature } from './decorateFeature'
import { laneKeyFor } from './laneKey'

import type { Lane } from './laneKey'
import type { BaseOptions } from '@jbrowse/core/data_adapters/BaseAdapter'
import type { Feature, Region } from '@jbrowse/core/util'

export default class SubtrackAdapter extends BaseFeatureDataAdapter {
  private async getSub(): Promise<BaseFeatureDataAdapter> {
    const getSubAdapter = this.getSubAdapter
    if (!getSubAdapter) {
      throw new Error('SubtrackAdapter: no getSubAdapter available')
    }
    const conf = this.getConf('subadapter')
    if (!conf) {
      throw new Error('SubtrackAdapter: no subadapter configured')
    }
    return (await getSubAdapter(conf)).dataAdapter as BaseFeatureDataAdapter
  }

  private get lanes(): Lane[] {
    return (this.getConf('lanes') as Lane[] | undefined) ?? []
  }

  public async getRefNames(opts?: BaseOptions) {
    return (await this.getSub()).getRefNames(opts)
  }

  /**
   * Stamps every feature with its lane and emits all of them — an unmatched
   * feature is emitted unstamped, landing in the catch-all section. Filtering
   * here would make lane selection change the data rather than the view, and
   * would refetch on every toggle.
   */
  public getFeatures(region: Region, opts?: BaseOptions) {
    return ObservableCreate<Feature>(async observer => {
      const sub = await this.getSub()
      const { lanes } = this
      sub.getFeatures(region, opts).subscribe({
        next: feature => {
          const lane = laneKeyFor(feature, lanes)
          observer.next(lane === undefined ? feature : decorateFeature(feature, lane))
        },
        error: e => { observer.error(e) },
        complete: () => { observer.complete() },
      })
    }, opts?.signal)
  }
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm test src/SubtrackAdapter/SubtrackAdapter.test.ts
```

Expected: PASS, 3 tests.

If `ObservableCreate`'s second argument does not accept `opts?.signal`, check its signature in `/home/jbrestel/jbrowse2/jb-v5/packages/core/src/util/rxjs.ts:18` and match it — v5 moved cancellation back to `AbortSignal`, so the parameter is a signal, not a stop token.

- [ ] **Step 6: Register the adapter**

`src/SubtrackAdapter/index.ts`:

```typescript
import AdapterType from '@jbrowse/core/pluggableElementTypes/AdapterType'

import configSchema from './configSchema'

import type PluginManager from '@jbrowse/core/PluginManager'

export default function SubtrackAdapterF(pluginManager: PluginManager) {
  pluginManager.addAdapterType(
    () =>
      new AdapterType({
        name: 'SubtrackAdapter',
        displayName: 'Subtrack adapter',
        configSchema,
        getAdapterClass: () =>
          import('./SubtrackAdapter').then(r => r.default),
      }),
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add src/SubtrackAdapter && git commit -m "feat: SubtrackAdapter stamping lane membership onto features"
```

---

## Task 7: Plugin entry point and a first end-to-end render

The first point at which a human can see lanes. Do not defer this — everything after it is polish, and if the premise is broken you want to know now.

**Files:**
- Create: `src/index.ts`
- Create: `test_config/subtrack-test.json`

- [ ] **Step 1: Write the plugin class**

Registration happens in `install()`, never `configure()` — the registry is frozen once `createPluggableElements()` runs.

```typescript
import Plugin from '@jbrowse/core/Plugin'

import SubtrackAdapterF from './SubtrackAdapter/index'

import type PluginManager from '@jbrowse/core/PluginManager'

export default class SubtrackRendererPlugin extends Plugin {
  name = 'SubtrackRenderer'

  install(pluginManager: PluginManager) {
    SubtrackAdapterF(pluginManager)
  }
}
```

- [ ] **Step 2: Build the bundle**

```bash
pnpm build
ls -la dist/
```

Expected: a `dist/jbrowse-plugin-subtrack-renderer.umd.development.js`.

- [ ] **Step 3: Serve the bundle**

```bash
npx serve --cors --listen 9002 .
```

- [ ] **Step 4: Write a test config that exercises lanes**

Create `test_config/subtrack-test.json` as a copy of the volvox config with one extra track. The track wraps volvox's GFF in a `SubtrackAdapter` and turns on grouping:

```json
{
  "type": "FeatureTrack",
  "trackId": "subtrack_demo",
  "name": "Subtrack demo",
  "assemblyNames": ["volvox"],
  "adapter": {
    "type": "SubtrackAdapter",
    "lanes": [
      { "label": "Genes",  "featureFilters": { "type": "gene" } },
      { "label": "mRNAs",  "featureFilters": { "type": "mRNA" } }
    ],
    "subadapter": {
      "type": "Gff3TabixAdapter",
      "gffGzLocation": { "uri": "volvox.sort.gff3.gz" }
    }
  },
  "displays": [
    {
      "type": "LinearBasicDisplay",
      "displayId": "subtrack_demo-LinearBasicDisplay",
      "groupBy": { "type": "attribute", "attribute": "subtrack" }
    }
  ]
}
```

Add the plugin to the config's `plugins` array:

```json
"plugins": [
  { "name": "SubtrackRenderer",
    "url": "http://localhost:9002/dist/jbrowse-plugin-subtrack-renderer.umd.development.js" }
]
```

- [ ] **Step 5: Load it and confirm lanes render**

Open jbrowse-web (port 3000) against this config and add the `subtrack_demo` track.

Expected: two labelled sections stacked vertically — "subtrack: Genes" and "subtrack: mRNAs" — each packing its own rows of gene glyphs.

The `"subtrack: "` label prefix is the known cosmetic defect recorded in the spec; it is the upstream label format, not a bug in this code.

- [ ] **Step 6: Confirm show/hide works with no code from us**

Open the track menu, find the group visibility entries, and hide one section.

Expected: the hidden lane's features leave the pack, the remaining lane reflows, and the track height shrinks. This is `hiddenGroupKeys`, working for free.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test_config/ && git commit -m "feat: plugin entry point, lanes rendering end to end"
```

**If Step 5 does not produce two sections, stop and report before continuing.** Every remaining task is UI on top of this.

---

## Task 8: Salvage resolveSubtracks

Verbatim from `init-dev`. It has zero JBrowse imports, so it ports unchanged.

**Files:**
- Create: `src/resolveSubtracks.ts`, `src/resolveSubtracks.test.ts` (from `init-dev`)

- [ ] **Step 1: Bring the files across**

```bash
cd /home/jbrestel/jbrowse2/jbrowse-plugin-subtrack-renderer
git checkout init-dev -- src/SubtrackFeatureDisplay/resolveSubtracks.ts
git checkout init-dev -- src/SubtrackFeatureDisplay/resolveSubtracks.test.ts
git mv src/SubtrackFeatureDisplay/resolveSubtracks.ts src/resolveSubtracks.ts
git mv src/SubtrackFeatureDisplay/resolveSubtracks.test.ts src/resolveSubtracks.test.ts
rmdir src/SubtrackFeatureDisplay 2>/dev/null || true
```

- [ ] **Step 2: Repoint its type import**

The v4 file imports `Subtrack` from the deleted renderer. Point it at `Lane` instead — the same shape:

```typescript
import type { Lane as Subtrack } from './SubtrackAdapter/laneKey'
```

Fix the test's import path the same way.

- [ ] **Step 3: Run the salvaged tests**

```bash
pnpm test src/resolveSubtracks.test.ts
```

Expected: PASS. These tests were written against v4 but test pure logic, so they should pass untouched. If any fail, the failure is real — investigate rather than editing the test to match.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck && git add -A && git commit -m "feat: salvage resolveSubtracks from the v4 implementation"
```

---

## Task 9: Display extension — registry augmentation and menu

**Files:**
- Create: `src/displayExtension/registry.d.ts`, `src/displayExtension/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Declare the registry entry**

`extendDisplayType` is typed as `N extends DisplayTypeName`, where `DisplayTypeName = keyof DisplayTypeRegistry`. Core declares `DisplayTypeRegistry` empty and only two in-tree displays augment it — `LinearBasicDisplay` is **not** one. Augmentation is additive, so declare it here.

`src/displayExtension/registry.d.ts`:

```typescript
import type { LinearBasicDisplayStateModel } from '@jbrowse/plugin-canvas/LinearBasicDisplay/stateModel'

declare module '@jbrowse/core/PluginManager' {
  interface DisplayTypeRegistry {
    LinearBasicDisplay: LinearBasicDisplayStateModel
  }
}
```

If that exported type name does not exist, check what the subpath actually exports:

```bash
grep -n "^export" /home/jbrestel/jbrowse2/jb-v5/plugins/canvas/src/LinearBasicDisplay/model.ts | head
```

Use the exported state-model type name you find. **Do not hand-copy the type** — import it and let the compiler catch drift.

- [ ] **Step 2: Verify the augmentation actually reaches the compiler**

A `declare module` block only applies if the module containing it is in the program. A file imported only for types can be elided.

```bash
pnpm typecheck
```

Then deliberately break it — change `LinearBasicDisplay` to `LinearBasicDisplayX` in `src/displayExtension/index.ts` (written next) and confirm `pnpm typecheck` **fails**. If it passes, the augmentation is not loading and `extendDisplayType` has silently fallen back to an unchecked path — exactly the `Core-extendWorker` failure mode recorded in upstream's ABI doc, which typechecked clean while being a runtime `TypeError`. Restore the correct name afterwards.

- [ ] **Step 3: Write the extension**

`src/displayExtension/index.ts`:

```typescript
import { getConf } from '@jbrowse/core/configuration'
import { extendDisplayType } from '@jbrowse/core/pluggableElementTypes'
import { getContainingTrack } from '@jbrowse/core/util'
import { cast, types } from '@jbrowse/mobx-state-tree'

import { resolveSubtracks } from '../resolveSubtracks'

import './registry.d'

import type { Lane } from '../SubtrackAdapter/laneKey'

/**
 * Returned unchanged when nothing is hidden. A module constant rather than a
 * fresh Set per read: downstream layout memos compare these by identity, so a
 * new empty Set every call would read as a change on every recompute.
 *
 * Core spells this `NO_HIDDEN_GROUPS` in `@jbrowse/display-kit`, which is NOT
 * on core's ReExports list — importing it at runtime would bundle a private
 * copy of that package. Declare our own; it is one empty Set.
 */
const NONE: ReadonlySet<string> = new Set()

/**
 * This extension composes onto EVERY LinearBasicDisplay, including tracks that
 * have nothing to do with subtracks, so every behavior it adds is gated on the
 * track actually being configured for them.
 */
function isSubtrackTrack(self: unknown) {
  try {
    return (
      getConf(getContainingTrack(self), ['adapter', 'type']) ===
      'SubtrackAdapter'
    )
  } catch {
    // a display not yet attached to a track has no adapter to ask about
    return false
  }
}

import type PluginManager from '@jbrowse/core/PluginManager'
import type { IAnyModelType } from '@jbrowse/mobx-state-tree'

export default function installDisplayExtension(pluginManager: PluginManager) {
  extendDisplayType(pluginManager, 'LinearBasicDisplay', stateModel =>
    (stateModel as IAnyModelType)
      .props({
        /**
         * The reader's chosen lane labels. `undefined` means "not yet chosen",
         * which resolveSubtracks reads as "fall back to the catalog defaults" —
         * so undefined and [] are different answers and must stay so.
         */
        subtrackSelection: types.maybe(types.array(types.string)),
      })
      .volatile(() => ({
        subtrackSelectorOpen: false,
      }))
      .actions(self => ({
        setSubtrackSelectorOpen(open: boolean) {
          self.subtrackSelectorOpen = open
        },
        setSubtrackSelection(labels: string[]) {
          self.subtrackSelection = cast(labels)
        },
      })),
  )
}
```

- [ ] **Step 4: Wire it into the plugin**

In `src/index.ts`, add to `install()`:

```typescript
import installDisplayExtension from './displayExtension/index'
// ...
    installDisplayExtension(pluginManager)
```

- [ ] **Step 5: Verify nothing regressed in the browser**

Rebuild, reload jbrowse-web, and confirm the `subtrack_demo` track still renders its two lanes with no console errors.

Expected: identical to Task 7. An MST composition error here throws during `install()`, which would make the track vanish entirely rather than fail loudly.

- [ ] **Step 6: Commit**

```bash
git add src/displayExtension src/index.ts
git commit -m "feat: extend LinearBasicDisplay with subtrack selector state"
```

---

## Task 10: Salvage the selector dialog

**Files:**
- Create: `src/SubtrackSelector/*` (from `init-dev`)

- [ ] **Step 1: Bring the directory across**

```bash
git checkout init-dev -- src/SubtrackSelector
git checkout init-dev -- docs/subtrack-selector.md
```

- [ ] **Step 2: Repoint type imports**

Anything importing `Subtrack` from the deleted `SubtrackFeatureRenderer/subtrackUtils` points at `Lane` in `src/SubtrackAdapter/laneKey.ts` instead.

```bash
grep -rn "SubtrackFeatureRenderer" src/SubtrackSelector/
```

Fix every hit. Expected after fixing: no output.

- [ ] **Step 3: Audit for MUI APIs removed in 9**

This repo was burned by exactly this before: a `Checkbox` with `inputProps={{'aria-label': name}}` passed every jsdom test — including tests that found rows *by that label* — and rendered with no accessible name in the real app, because `inputProps` was removed in MUI 9.

```bash
grep -rn "inputProps\|InputProps\|componentsProps" src/SubtrackSelector/
```

Every hit becomes the `slotProps` equivalent, e.g. `slotProps={{ input: { 'aria-label': name } }}`, which works on both 7 and 9.

- [ ] **Step 4: Run the salvaged tests**

```bash
pnpm test src/SubtrackSelector
```

Expected: PASS, 3 suites.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck && git add -A && git commit -m "feat: salvage the faceted subtrack selector dialog"
```

---

## Task 11: Wire the dialog to lane visibility

**Files:**
- Modify: `src/displayExtension/index.ts`

- [ ] **Step 1: Hide lanes through the sanctioned hook, not a setter**

`HiddenGroupsMixin` (`packages/display-kit/src/HiddenGroupsMixin.ts`) owns lane
visibility and exposes exactly two routes:

- `hiddenGroups` — a **volatile** set of sections *the reader* hid from a chip,
  with `hideGroup` / `showAllGroups` over it.
- `displayHiddenGroupKeys` — an overridable getter documented as "lanes the
  DISPLAY hides on its own behalf". `LGVSyntenyDisplay` hides an all-vs-all
  track's self-alignment lane through it.

`hiddenGroupKeys` folds both, and there is **no `setHiddenGroupKeys`**. We are a
display hiding lanes on its own behalf, so we override the getter. Add to the
extension a `.views()` block:

```typescript
      .views(self => ({
        /**
         * The catalog lives on the adapter config. resolveSubtracks dedupes it
         * and drops selections naming a lane the config has retired, so a stale
         * session degrades gracefully instead of hiding real lanes.
         */
        get displayHiddenGroupKeys(): ReadonlySet<string> {
          const { subtrackSelection } = self
          if (!subtrackSelection || !isSubtrackTrack(self)) {
            return NONE
          }
          const catalog =
            (getConf(getContainingTrack(self), ['adapter', 'lanes']) as
              | Lane[]
              | undefined) ?? []
          const keep = new Set(
            resolveSubtracks(catalog, [...subtrackSelection]).map(l => l.label),
          )
          const hidden = catalog
            .map(l => l.label)
            .filter(label => !keep.has(label))
          return hidden.length === 0 ? NONE : new Set(hidden)
        },
      }))
```

A getter, not an action: visibility is *derived* from the selection, so there is
no second copy of the truth to keep in sync, and the reader's own chip-hiding
composes on top for free.

- [ ] **Step 2: Add the menu item**

Append to the extension's `.actions()` block:

```typescript
      .actions(self => {
        const superTrackMenuItems = self.trackMenuItems
        return {
          trackMenuItems() {
            const base = superTrackMenuItems()
            if (!isSubtrackTrack(self)) {
              return base
            }
            // Upstream's "Group by..." calls applyGroupBy, which would replace
            // our {type:'attribute', attribute:'subtrack'} wholesale. Picking
            // Strand there makes the lanes vanish and leaves the lane-label
            // hidden keys matching no section — a silent break, so the entry
            // comes off on tracks we own. Every other track keeps it.
            return [
              ...base.filter(item => item.label !== 'Group by...'),
              {
                label: 'Select subtracks...',
                onClick: () => { self.setSubtrackSelectorOpen(true) },
              },
            ]
          },
        }
      })
```

Note the super-capture: MST actions capture the base implementation before
overriding. This is the normal action pattern — it is only `afterAttach` that
must **not** chain to super, because the MST fork auto-chains lifecycle hooks
and calling it installs every fetch autorun twice.

- [ ] **Step 2b: Know what resets, and confirm our selection does not**

`HiddenGroupsMixin` installs a reaction that calls `dropGroupState()` whenever
the display's `groupKeySpace` moves, clearing `hiddenGroups`. That is deliberate:
a key names a section only within the grouping that issued it.

Our selection is a **prop**, not volatile, and `dropGroupState` does not touch
it — correct, because our keys are lane labels from the config, whose meaning
does not change when the grouping dimension does. Verify this holds: switch the
track's grouping to Strand and back, and confirm the lane selection survives.

If a future change makes lane labels dependent on the dimension, this becomes
wrong and the selection must move under an overridden `dropGroupState` that
calls through.

- [ ] **Step 2c: Confirm the gate is tight in both directions**

Matching on a menu label is brittle — an upstream rename turns this filter into
a silent no-op. Pin it with a test asserting the entry is absent on a subtrack
track and present on an ordinary one, so a rename fails loudly here rather than
surfacing as a user destroying their own lanes.

In the browser, confirm both directions: a `SubtrackAdapter` track shows
"Select subtracks..." and no "Group by...", and a stock `gff3tabix_genes` track
still shows "Group by..." exactly as before.

- [ ] **Step 3: Verify in the browser**

Rebuild, reload, open the track menu.

Expected: "Select subtracks..." appears. Choosing it opens the faceted dialog. Deselecting a lane and confirming makes that lane's features leave the pack and the track reflow — with **no network request**, because visibility is display-side only and never touches the adapter config.

Confirm the no-refetch claim in the browser devtools Network tab. A request on toggle means lane visibility has leaked into the adapter config, which forks the adapter cache and re-parses the file per toggle.

- [ ] **Step 4: Commit**

```bash
git add src/displayExtension && git commit -m "feat: wire the selector dialog to lane visibility"
```

---

## Task 12: Documentation and cleanup

**Files:**
- Modify: `README.md`
- Rewrite: `docs/upstream-canvas-extensibility.md`

- [ ] **Step 1: Rewrite the upstream-ask doc**

The v4 doc asked for a `CanvasPlugin.exports` block and a layout-key hook. Both are obsolete: v5 removed the runtime `exports` channel for new plugin code, and we no longer need the layout hook.

Replace it with the deferred ask from the spec: give the `attribute` group-by dimension an explicit value order and a label format. Record the two defects it fixes (code-point lane ordering; `"subtrack: X"` labels), cite `featureGroupSections` and `FEATURE_GROUP_BY_DIMENSIONS.attribute`, and note that the multi-row display already has `rowOrder` while `groupBy` has nothing.

- [ ] **Step 2: Write the README**

Cover: what the plugin does, the config shape for a `SubtrackAdapter` track with `groupBy`, the JBrowse version it requires, and the two known cosmetic defects with a pointer to the upstream ask.

- [ ] **Step 3: Confirm the whole suite is green**

```bash
pnpm test && pnpm typecheck
```

Expected: all suites pass, typecheck exits 0.

- [ ] **Step 4: Confirm the dead code really is gone**

```bash
test ! -d src/SubtrackFeatureRenderer && echo "forked renderer absent"
grep -rn "g2p_mapper" package.json src/ || echo "g2p_mapper absent"
```

Expected: both confirmations print.

- [ ] **Step 5: Commit and push**

```bash
git add -A && git commit -m "docs: README and the revised upstream ask"
git push -u origin v5-rewrite
```

---

## Notes carried from hard-won experience

- **Register in `install()`, never `configure()`.** The registry is frozen once `createPluggableElements()` runs.
- **Never mutate `self` from inside a `reaction`/`when`/`autorun`.** Effects fire outside MST action context; route every mutation through an action.
- **A green jsdom test is not evidence a component renders.** `@mui/material` is on core's ReExports list, so the plugin gets the *host's* copy at runtime while jest renders against the plugin's own devDependency. Verify UI in a real build.
- **`pnpm lint` is red at baseline** in this repo (219 pre-existing errors on `init-dev`). Do not use it as a pass/fail gate; lint only what you touch: `npx eslint src/<dir>`.
- **Relative imports carry no `.ts` extension here.** Upstream writes
  `from './foo.ts'` because it sets `allowImportingTsExtensions` with
  `noEmit`. We emit through rollup, so we cannot; write `from './foo'`.
- **`moduleResolution` must be `"bundler"`.** Core 5 is ESM-only behind an
  `exports` map. Node10 resolution ignores `exports` entirely, and the failure
  is quiet: rollup still externalises the specifier and emits a working bundle,
  so only a typecheck over real imports catches it.
- **Do not hand-copy a type from jbrowse-components.** Three separate bugs in the v4 plugin were hand-written mirrors of core types that had silently drifted. Import it and let the compiler catch drift.
