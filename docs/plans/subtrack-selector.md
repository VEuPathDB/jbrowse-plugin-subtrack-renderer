# Subtrack Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user turn subtrack lanes on and off and reorder them, via a faceted two-pane dialog on the track menu.

**Architecture:** The renderer config's `subtracks` array becomes a read-only *catalog*. `SubtrackFeatureDisplay` gains one MST property, `subtrackSelection` (ordered labels of visible lanes, `undefined` = use catalog defaults), which it resolves against the catalog and publishes through `renderProps()`. Because core's `renderBlockData()` calls `renderProps()` inside a mobx reaction, changing the selection re-renders every visible block at once — the same mechanism `subtrackLaneHeights` already uses. A self-contained faceted selector (`src/SubtrackSelector/`) reads rows in and emits an ordered label list out; it never calls back into the display.

**Tech Stack:** TypeScript, MobX-State-Tree (`@jbrowse/mobx-state-tree`), React + MUI 7, mobx-react, jest + ts-jest, @testing-library/react. **No new dependencies** — every package needed is already a devDependency.

**Spec:** `docs/subtrack-selector.md`. Read it before starting.

**One deliberate departure from the spec:** the spec's faceted model carries a
`showSparse` flag (and the `findNonSparseKeys` helper) copied from JBrowse 2.
That flag exists because *track* metadata is wildly heterogeneous — most tracks
lack most keys, so the facet list needs pruning. Subtracks within a single track
share a near-uniform key set, so there is nothing sparse to hide. Dropped on
YAGNI grounds. If a real catalog turns out to have ragged keys, add it back.

**Worktree:** `.worktrees/subtrack-selector`, branch `feature/subtrack-selector`, branched from `init-dev`. Baseline is green: 80 tests, 15 snapshots, 6 suites.

---

## Orientation for someone new to this codebase

Things that will bite you if nobody tells you:

**Every shell must select Node 22 first.** `pnpm` is only on `PATH` under the Node 22 nvm install, and the build scripts are TypeScript run directly by Node. Node 20 fails with a confusing `Unknown file extension ".ts"`.

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22
cd /home/jbrestel/jbrowse2/jbrowse-plugin-subtrack-renderer/.worktrees/subtrack-selector
```

**Code style:** Prettier with **no semicolons**, single quotes, trailing commas. Strict TS with `noUncheckedIndexedAccess` (so `arr[0]` is `T | undefined` — you must narrow). Run `pnpm format` before committing if unsure.

**`getConf(self, ['renderer'])` returns a plain object, not a config model.** `readConfObject` on a nested config schema hits `structuredClone(getSnapshot(val))`, and `getSnapshot` **strips slots left at their default value**. That is why `createRenderConfigContext` passes explicit fallbacks (`createCachedConfig(config, 'color1', 'goldenrod')`). Do not assume a default-valued slot is present on `rendererConfig`. `subtrackConfig.enabled` is safe to read because enabling subtracks at all requires setting it explicitly.

**Never mutate `self` from inside a `reaction`/`autorun`.** MST throws "the object is protected". Route every mutation through an action.

**Never hand-copy a type from jbrowse-components.** If core exports it, `import type` it — that is free, since `import type` is erased before the bundle.

Useful commands:

```bash
pnpm test                 # jest, ~13s
pnpm test -- <pattern>    # single suite
pnpm typecheck            # tsc --noEmit
pnpm build                # rollup -> dist/*.umd.development.js
```

**Do NOT use `pnpm lint` as a gate — it is red at baseline** (219 errors on
untouched `init-dev`, all pre-existing and none of them ours). Lint only the
files you touched:

```bash
npx eslint src/SubtrackSelector src/SubtrackFeatureDisplay/resolveSubtracks.ts
```

That must be clean. Do not "fix" the 219 pre-existing errors — that is not this
feature's job and it would bury the diff.

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/SubtrackFeatureDisplay/resolveSubtracks.ts` | Pure: `(catalog, selection) -> ordered visible Subtrack[]`. Dedupe, default-visibility, unknown-label dropping. All the display's logic lives here so the MST model stays thin. |
| `src/SubtrackFeatureDisplay/resolveSubtracks.test.ts` | Tests for the above. |
| `src/SubtrackSelector/subtrackRows.ts` | Pure: catalog → rows, facet keys, drill-down facet counts. Knows nothing of MST or React. |
| `src/SubtrackSelector/subtrackRows.test.ts` | Tests for the above. |
| `src/SubtrackSelector/facetedSubtrackModel.ts` | MST model: filters, text search, working copy of the ordered selection. Knows nothing of `SubtrackFeatureDisplay`. |
| `src/SubtrackSelector/facetedSubtrackModel.test.ts` | Tests for the above. |
| `src/SubtrackSelector/FacetPanel.tsx` | Left pane: one `<Select multiple native>` per facet, with counts. |
| `src/SubtrackSelector/SubtrackTable.tsx` | Centre pane: virtualized checkbox table. |
| `src/SubtrackSelector/SelectedLanesPanel.tsx` | Right pane: ordered, drag-reorderable list. |
| `src/SubtrackSelector/SubtrackSelectorDialog.tsx` | Assembles the three panes; owns Cancel/Apply/Reset. The only file that touches the display. |
| `src/SubtrackSelector/SubtrackSelectorDialog.test.tsx` | RTL test of the transaction boundary. |

**Modify:**

| File | Change |
| --- | --- |
| `src/SubtrackFeatureDisplay/model.ts` | Add `subtrackSelection` prop, `subtrackCatalog` / `resolvedSubtracks` views, `setSubtrackSelection` / `resetSubtrackSelection` actions, `subtracks` in `renderProps()`, `trackMenuItems()` override. |
| `src/SubtrackFeatureRenderer/renderConfig.ts:92-140` | `createRenderConfigContext(config, subtracksOverride?)` — prefer the override, fall back to config. |
| `src/SubtrackFeatureRenderer/doAll.ts:48` | Pass `renderProps.subtracks` into `createRenderConfigContext`. |
| `src/SubtrackFeatureRenderer/SubtrackFeatureRenderer.ts:229` | Layout-clearing loop must use the same resolved subtrack list, not `readConfObject(config, 'subtracks')`. |

The boundary that matters: **`src/SubtrackSelector/` imports nothing from `src/SubtrackFeatureDisplay/` except the `Subtrack` type.** The dialog receives the display as an opaque prop with two methods. This is what makes the upstream follow-on (`docs/subtrack-selector.md`, "Follow-on") a deletion rather than a rewrite. Do not breach it for convenience.

---

## Task 1: Resolve catalog + selection into lanes

The display's entire decision logic, as a pure function, so that no MST test harness (which would need a real `PluginManager` with the LGV plugin) is ever needed to test it.

**Files:**
- Create: `src/SubtrackFeatureDisplay/resolveSubtracks.ts`
- Test: `src/SubtrackFeatureDisplay/resolveSubtracks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/SubtrackFeatureDisplay/resolveSubtracks.test.ts`:

```ts
import { dedupeCatalog, resolveSubtracks } from './resolveSubtracks'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  { label: 'Genes', featureFilters: { type: 'gene' }, visible: true },
  { label: 'Matches', featureFilters: { type: 'match' }, visible: false },
  { label: 'Repeats', featureFilters: { type: 'repeat' }, visible: true },
]

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
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22
pnpm test -- resolveSubtracks
```

Expected: FAIL — `Cannot find module './resolveSubtracks'`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `src/SubtrackFeatureDisplay/resolveSubtracks.ts`:

```ts
import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

/**
 * The label is the lane's identity: laneHeights is keyed by it, buildLayoutKey()
 * composes it into the layout key, and the selector uses it as the row id and
 * the selection token. A duplicate silently corrupts lane geometry, so drop it
 * loudly rather than quietly.
 */
export function dedupeCatalog(catalog: Subtrack[]): Subtrack[] {
  const seen = new Set<string>()
  const out: Subtrack[] = []
  const duplicates: string[] = []

  for (const subtrack of catalog) {
    if (seen.has(subtrack.label)) {
      duplicates.push(subtrack.label)
      continue
    }
    seen.add(subtrack.label)
    out.push(subtrack)
  }

  if (duplicates.length) {
    console.warn(
      `[SubtrackRenderer] ignoring duplicate subtrack labels: ${duplicates.join(', ')}. ` +
        'Labels identify lanes, so duplicates corrupt lane geometry.',
    )
  }

  return out
}

/**
 * Turn the config catalog plus the user's selection into the ordered list of
 * lanes to draw.
 *
 * `selection` undefined means the user has not chosen yet, so fall back to the
 * catalog's own defaults. Labels absent from the catalog are dropped, which is
 * how a config that retires a subtrack degrades a stale session gracefully
 * instead of crashing it.
 */
export function resolveSubtracks(
  catalog: Subtrack[],
  selection: string[] | undefined,
): Subtrack[] {
  const deduped = dedupeCatalog(catalog)

  if (!selection) {
    return deduped.filter(s => s.visible !== false)
  }

  const byLabel = new Map(deduped.map(s => [s.label, s]))
  const used = new Set<string>()
  const out: Subtrack[] = []

  for (const label of selection) {
    const subtrack = byLabel.get(label)
    if (subtrack && !used.has(label)) {
      used.add(label)
      // an explicit selection overrides the catalog's default-off flag
      out.push({ ...subtrack, visible: true })
    }
  }

  return out
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
pnpm test -- resolveSubtracks
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackFeatureDisplay/resolveSubtracks.ts src/SubtrackFeatureDisplay/resolveSubtracks.test.ts
git commit -m "Add pure resolution of subtrack catalog plus user selection

The display's whole decision -- which lanes, in what order -- as a pure
function, so it can be tested without standing up a PluginManager and the LGV
plugin just to instantiate the display model.

Dedupes on label, because label is already the lane identity (laneHeights key,
buildLayoutKey component) and a duplicate silently corrupts lane geometry."
```

---

## Task 2: Renderer prefers `renderProps.subtracks` over config

The renderer stops being the authority on which subtracks exist. It keeps the config fallback so it remains standalone-testable and the existing image snapshots stay green.

**Files:**
- Modify: `src/SubtrackFeatureRenderer/renderConfig.ts:92-140`
- Modify: `src/SubtrackFeatureRenderer/doAll.ts:48`
- Modify: `src/SubtrackFeatureRenderer/SubtrackFeatureRenderer.ts:229`
- Test: `src/SubtrackFeatureRenderer/renderConfig.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/SubtrackFeatureRenderer/renderConfig.test.ts`. Note the two new imports at the top of the file — add them to the existing import block:

```ts
import PluginManager from '@jbrowse/core/PluginManager'

import configSchema from './configSchema'
import { createRenderConfigContext, readCachedConfig } from './renderConfig'

import type { Subtrack } from './subtrackUtils'
```

Then append this `describe` block:

```ts
describe('createRenderConfigContext subtracks', () => {
  const pluginManager = new PluginManager([])
  pluginManager.configure()

  const CONFIG_SUBTRACKS: Subtrack[] = [
    { label: 'FromConfig', featureFilters: { type: 'gene' }, visible: true },
  ]

  function makeConfig() {
    return configSchema.create(
      {
        subtracks: CONFIG_SUBTRACKS,
        subtrackConfig: { enabled: true },
      },
      { pluginManager },
    )
  }

  it('falls back to the config when no override is supplied', () => {
    const ctx = createRenderConfigContext(makeConfig())

    expect(ctx.subtracks.map(s => s.label)).toEqual(['FromConfig'])
  })

  it('prefers the override supplied by the display', () => {
    const override: Subtrack[] = [
      { label: 'FromDisplay', featureFilters: { type: 'match' }, visible: true },
    ]

    const ctx = createRenderConfigContext(makeConfig(), override)

    expect(ctx.subtracks.map(s => s.label)).toEqual(['FromDisplay'])
  })

  it('an empty override yields no lanes', () => {
    const ctx = createRenderConfigContext(makeConfig(), [])

    expect(ctx.subtracks).toEqual([])
  })
})
```

That last case asserts that deselecting every lane draws no lanes, rather than
silently resurrecting the config's.

> **Correction.** An earlier draft of this plan claimed `override || readConf(...)`
> would wrongly fall back here, and that `??` was required to prevent it. **That
> is false: `[]` is truthy in JavaScript**, so `[] || fallback` evaluates to `[]`
> exactly as `[] ?? fallback` does. The two operators are indistinguishable for
> a value typed `Subtrack[] | undefined`. Use `??` anyway — it states the intent
> and stays correct if the type ever admits `null` — but do not believe, or
> re-assert, that a test can tell them apart.

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm test -- renderConfig
```

Expected: FAIL — "prefers the override" and "empty override" fail (`createRenderConfigContext` takes one argument, so the override is ignored and both return `['FromConfig']`).

- [ ] **Step 3: Implement the minimal code to make the test pass**

In `src/SubtrackFeatureRenderer/renderConfig.ts`, change the signature at line 92 and the `subtracks` line at 122:

```ts
export function createRenderConfigContext(
  config: AnyConfigurationModel,
  subtracksOverride?: Subtrack[],
): RenderConfigContext {
```

and

```ts
    // The display owns which subtracks are shown and in what order, and hands
    // the resolved list down through renderProps. The config fallback keeps the
    // renderer usable standalone (and keeps the image snapshot tests green).
    // The override is authoritative whenever the display supplies one --
    // including when it is empty, meaning the user deselected every lane.
    subtracks:
      subtracksOverride ??
      ((readConfObject(config, 'subtracks') || []) as Subtrack[]),
```

`Subtrack` is already imported in this file (it is used by `RenderConfigContext`); confirm the import exists and add it if not.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
pnpm test -- renderConfig
```

Expected: PASS.

- [ ] **Step 5: Thread the override through `doAll`**

In `src/SubtrackFeatureRenderer/doAll.ts`, the destructure at line 35 currently reads:

```ts
  const { statusCallback = () => {}, regions, bpPerPx, config } = renderProps
```

Change it to pull `subtracks` off `renderProps` too, and pass it in at line 48:

```ts
  const {
    statusCallback = () => {},
    regions,
    bpPerPx,
    config,
    subtracks: subtracksFromDisplay,
  } = renderProps as RenderArgsDeserialized & { subtracks?: Subtrack[] }
```

```ts
  // Create config context ONCE at the start - this reads all config values upfront
  // to avoid expensive readConfObject calls in per-feature hot paths
  const configContext = createRenderConfigContext(config, subtracksFromDisplay)
```

Add `import type { Subtrack } from './subtrackUtils'` to the imports if it is not already there. The cast is needed because core's `RenderArgsDeserialized` has no `subtracks` field — this is the same shape of extension `subtrackLaneHeights` already uses, so follow whatever pattern that one established in this file.

- [ ] **Step 6: Fix the layout-clearing loop**

`src/SubtrackFeatureRenderer/SubtrackFeatureRenderer.ts:229` clears one sublayout per subtrack and still reads the config directly:

```ts
    // Get subtrack names from config and clear each sublayout
    const subtracks = readConfObject(config, 'subtracks') || []
    for (const subtrack of subtracks) {
      if (subtrack.visible !== false) {
```

If the display hides a lane but this loop still clears by the *config* list, it clears sublayouts that are no longer drawn and — worse — fails to clear one the user has just turned on. Both leave stale rectangles. Change it to use the same list the renderer will actually draw:

```ts
    // Must match the list doAll() will actually lay out: the display's resolved
    // selection when present, the config catalog otherwise. Clearing a different
    // set than we draw leaves stale rectangles in the sublayouts.
    const subtracks =
      (renderProps as { subtracks?: Subtrack[] }).subtracks ??
      ((readConfObject(config, 'subtracks') || []) as Subtrack[])
    for (const subtrack of subtracks) {
      if (subtrack.visible !== false) {
```

Add the `Subtrack` type import if absent.

- [ ] **Step 7: Run the whole suite**

```bash
pnpm test && pnpm typecheck
```

Expected: PASS — all 80 baseline tests plus the 3 new ones, 15 snapshots unchanged. **The snapshots staying green is the point**: it proves the config fallback path is intact.

- [ ] **Step 8: Commit**

```bash
git add src/SubtrackFeatureRenderer/
git commit -m "Let the display override which subtracks the renderer draws

createRenderConfigContext takes an optional subtracks list, which doAll pulls
off renderProps. The config remains the fallback, so the renderer stays
standalone-testable and the image snapshots are untouched.

The override is authoritative whenever the display supplies one, including when
it is empty -- deselecting every lane draws no lanes rather than silently
resurrecting the config's.

Also fixes the layout-clearing loop, which cleared sublayouts by the config list
rather than the list actually being drawn -- with a user selection in play that
would clear lanes we no longer draw and skip the one just switched on, leaving
stale rectangles behind."
```

---

## Task 3: Display owns the selection

**Files:**
- Modify: `src/SubtrackFeatureDisplay/model.ts`

No unit test here by design: all the logic is in `resolveSubtracks` (Task 1, fully tested). Testing this file would mean standing up a `PluginManager` with the LGV plugin to get `BaseLinearDisplay`, to assert MST plumbing that MST already guarantees. The wiring is verified end-to-end in Task 8.

- [ ] **Step 1: Add the property, views and actions**

In `src/SubtrackFeatureDisplay/model.ts`:

Add to the imports:

```ts
import { resolveSubtracks } from './resolveSubtracks'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'
```

Add the property to the inner `types.model` inside `types.compose` (currently only holds `type`):

```ts
      types.model({
        /**
         * #property
         */
        type: types.literal('SubtrackFeatureDisplay'),
        /**
         * #property
         * Ordered labels of the lanes the user wants to see, top to bottom.
         * For a lane list, selection *is* order, so one property carries both.
         *
         * undefined means "the user has not chosen", so the catalog's own
         * defaults apply. Being an MST property it rides the session snapshot,
         * so a shared session URL carries the user's lane selection -- and a
         * user who never opens the selector adds nothing to the snapshot.
         */
        subtrackSelection: types.maybe(types.array(types.string)),
      }),
```

Add these two getters to the **existing** `.views(self => ({ ... }))` block that already holds `rendererTypeName`, `rendererConfig` and `requiredLaneHeights`:

```ts
      /**
       * #getter
       * Every subtrack the config declares. Read-only: the config declares, the
       * display decides.
       */
      get subtrackCatalog(): Subtrack[] {
        // rendererConfig is a plain object (readConfObject on a nested schema
        // returns a snapshot, not a config model), so this is a plain read
        return (self.rendererConfig?.subtracks ?? []) as Subtrack[]
      },
```

and, because `resolvedSubtracks` must be able to see `subtrackCatalog`, put it in a **new** `.views` block chained after that one (MST cannot self-reference across a single `.views` object literal without `this`, and a second block is clearer):

```ts
    .views(self => ({
      /**
       * #getter
       * The ordered, visible lanes to draw: the user's selection resolved
       * against the catalog, or the catalog's defaults if they have not chosen.
       */
      get resolvedSubtracks(): Subtrack[] {
        return resolveSubtracks(
          self.subtrackCatalog,
          self.subtrackSelection ? [...self.subtrackSelection] : undefined,
        )
      },
    }))
```

The `[...self.subtrackSelection]` spread converts the MST array to a plain one. `resolveSubtracks` is a plain function and should not be handed a live MST node.

Add these to the **existing** `.actions(self => ({ ... }))` block that holds `setLaneHeights`:

```ts
      /**
       * #action
       */
      setSubtrackSelection(labels: string[]) {
        self.subtrackSelection = cast(labels)
      },
      /**
       * #action
       * Back to the catalog's defaults. Clearing to undefined (rather than
       * writing the default list out) keeps the session snapshot clean and lets
       * a later config change introduce new lanes.
       */
      resetSubtrackSelection() {
        self.subtrackSelection = undefined
      },
```

`cast` comes from `@jbrowse/mobx-state-tree` — add it to that import line alongside `addDisposer`, `types`, `Instance`.

- [ ] **Step 2: Publish the resolved list to the renderer**

In the `.views` block that overrides `renderProps()`, add one line:

```ts
        renderProps() {
          return {
            ...superRenderProps(),
            config: self.rendererConfig,
            filters: new SerializableFilterChain({ filters: [] }),
            subtrackLaneHeights: self.laneHeights,
            subtracks: self.resolvedSubtracks,
          }
        },
```

That one line is the whole re-render mechanism. `renderBlockData()` reads `renderProps()` inside a mobx reaction, so changing `subtrackSelection` invalidates every block at once and the visible region redraws with the new lane set. There is no `reload()` to call and none should be added.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: PASS, no behaviour change yet (nothing sets `subtrackSelection`, so `resolvedSubtracks` returns the catalog defaults, which is exactly what the renderer drew before).

- [ ] **Step 4: Commit**

```bash
git add src/SubtrackFeatureDisplay/model.ts
git commit -m "Give SubtrackFeatureDisplay an ordered subtrack selection

One MST property carries both which lanes are visible and what order they are
in, because for a lane list those are the same thing. undefined means the user
has not chosen, so the catalog's defaults apply -- which keeps the session
snapshot empty until someone actually makes a choice.

Publishing resolvedSubtracks through renderProps() is what makes a selection
change redraw the whole visible region: renderBlockData() reads renderProps()
inside a mobx reaction, so every block is invalidated at once. Same mechanism
laneHeights already uses."
```

---

## Task 4: Catalog to rows and facets

Pure functions, no MST, no React. This is where the JBrowse 1 metadata trick gets ported: `featureFilters` do double duty as both the lane-assignment predicate and the facetable columns, so a synteny track's filter attributes are automatically facets with no extra plumbing.

**Files:**
- Create: `src/SubtrackSelector/subtrackRows.ts`
- Test: `src/SubtrackSelector/subtrackRows.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/SubtrackSelector/subtrackRows.test.ts`:

```ts
import { getFacetCounts, getFacetKeys, toRows } from './subtrackRows'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  {
    label: 'Pf 3D7',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: '3D7', study: 'Ref' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: 'HB3', study: 'Cross' },
    visible: true,
  },
  {
    label: 'Pv Sal-1',
    featureFilters: { organism: 'P. vivax' },
    metadata: { strain: 'Sal-1', study: 'Ref' },
    visible: false,
  },
]

describe('toRows', () => {
  it('merges featureFilters and metadata into one flat field map', () => {
    const rows = toRows(CATALOG)

    expect(rows[0]).toEqual({
      id: 'Pf 3D7',
      name: 'Pf 3D7',
      fields: {
        organism: 'P. falciparum',
        strain: '3D7',
        study: 'Ref',
      },
    })
  })

  it('lets metadata win a key collision with featureFilters', () => {
    const collide: Subtrack[] = [
      {
        label: 'X',
        featureFilters: { organism: 'from-filters' },
        metadata: { organism: 'from-metadata' },
        visible: true,
      },
    ]

    expect(toRows(collide)[0]!.fields.organism).toBe('from-metadata')
  })

  it('stringifies primitive values and skips non-primitives', () => {
    const mixed: Subtrack[] = [
      {
        label: 'X',
        featureFilters: { count: 3, ok: true, types: ['a', 'b'] },
        metadata: { range: { min: 1, max: 2 } as unknown as string },
        visible: true,
      },
    ]

    // arrays and objects are predicates, not descriptors -- they still assign
    // features to a lane, they just are not facetable
    expect(toRows(mixed)[0]!.fields).toEqual({ count: '3', ok: 'true' })
  })

  it('tolerates a subtrack with no metadata at all', () => {
    const bare: Subtrack[] = [
      { label: 'X', featureFilters: { type: 'gene' }, visible: true },
    ]

    expect(toRows(bare)[0]!.fields).toEqual({ type: 'gene' })
  })
})

describe('getFacetKeys', () => {
  it('is the union of all field keys across rows, sorted', () => {
    expect(getFacetKeys(toRows(CATALOG))).toEqual([
      'organism',
      'strain',
      'study',
    ])
  })
})

describe('getFacetCounts', () => {
  const rows = toRows(CATALOG)
  const keys = getFacetKeys(rows)

  it('counts every value of every facet when nothing is filtered', () => {
    const counts = getFacetCounts(rows, keys, new Map())

    expect(counts.get('organism')).toEqual(
      new Map([
        ['P. falciparum', 2],
        ['P. vivax', 1],
      ]),
    )
    expect(counts.get('study')).toEqual(
      new Map([
        ['Ref', 2],
        ['Cross', 1],
      ]),
    )
  })

  it('drills down: a filtered facet still counts against the pre-filter rows', () => {
    // this is the non-obvious bit, copied from JBrowse 2's FacetFilters.tsx --
    // selecting P. falciparum must NOT zero out P. vivax in its own facet, or
    // the user can never widen their selection again
    const filters = new Map([['organism', ['P. falciparum']]])
    const counts = getFacetCounts(rows, keys, filters)

    expect(counts.get('organism')).toEqual(
      new Map([
        ['P. falciparum', 2],
        ['P. vivax', 1],
      ]),
    )
    // but OTHER facets are narrowed by the organism filter
    expect(counts.get('study')).toEqual(
      new Map([
        ['Ref', 1],
        ['Cross', 1],
      ]),
    )
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm test -- subtrackRows
```

Expected: FAIL — `Cannot find module './subtrackRows'`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `src/SubtrackSelector/subtrackRows.ts`:

```ts
import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

export interface SubtrackRow {
  /** the subtrack label; the lane identity everywhere in this plugin */
  id: string
  name: string
  /** featureFilters merged under metadata, primitives only */
  fields: Record<string, string>
}

/**
 * Only primitive values become facets. An array or a {min,max} range is a
 * predicate, not a descriptor -- it still assigns features to a lane, it just
 * makes no sense as a column to filter the selector on. Same rule as JBrowse 2's
 * getRootKeys().
 */
function flatten(obj: Record<string, unknown> | undefined) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (value !== null && value !== undefined && typeof value !== 'object') {
      out[key] = String(value)
    }
  }
  return out
}

/**
 * The JBrowse 1 trick, ported: featureFilters do double duty as the
 * lane-assignment predicate AND the facetable columns, so whatever attribute a
 * synteny subtrack filters on is automatically an attribute the selector can
 * facet on. No metadata service, no adapter, no fetch.
 *
 * metadata is spread last so it wins a key collision, matching JBrowse 1's
 * `dojo.mixin(base, featureFilters, metadata)` argument order.
 */
export function toRows(catalog: Subtrack[]): SubtrackRow[] {
  return catalog.map(subtrack => ({
    id: subtrack.label,
    name: subtrack.label,
    fields: {
      ...flatten(subtrack.featureFilters),
      ...flatten(subtrack.metadata),
    },
  }))
}

export function getFacetKeys(rows: SubtrackRow[]): string[] {
  return [...new Set(rows.flatMap(row => Object.keys(row.fields)))].sort()
}

/**
 * Counts per value, per facet, with drill-down semantics copied from JBrowse 2's
 * FacetFilters.tsx: facets that already have an active filter are counted
 * against the row set as it stood BEFORE that filter was applied. Otherwise
 * selecting "P. falciparum" would show every other organism with a count of
 * zero, and the user could never widen the selection again.
 */
export function getFacetCounts(
  rows: SubtrackRow[],
  facetKeys: string[],
  filters: Map<string, string[]>,
): Map<string, Map<string, number>> {
  const counts = new Map(
    facetKeys.map(key => [key, new Map<string, number>()] as const),
  )

  // active facets first, so each is counted before its own filter narrows things
  const ordered = [
    ...facetKeys.filter(key => filters.get(key)?.length),
    ...facetKeys.filter(key => !filters.get(key)?.length),
  ]

  let current = rows
  for (const key of ordered) {
    const counter = counts.get(key)!
    for (const row of current) {
      const value = row.fields[key]
      if (value) {
        counter.set(value, (counter.get(value) ?? 0) + 1)
      }
    }

    const selected = filters.get(key)
    if (selected?.length) {
      const selectedSet = new Set(selected)
      current = current.filter(row => {
        const value = row.fields[key]
        return value !== undefined && selectedSet.has(value)
      })
    }
  }

  return counts
}

/** Rows surviving the text search and every active facet filter. */
export function filterRows(
  rows: SubtrackRow[],
  filterText: string,
  filters: Map<string, string[]>,
): SubtrackRow[] {
  const query = filterText.trim().toLowerCase()

  const active = [...filters.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => [key, new Set(values)] as const)

  return rows.filter(row => {
    if (
      query &&
      !row.name.toLowerCase().includes(query) &&
      !Object.values(row.fields).some(v => v.toLowerCase().includes(query))
    ) {
      return false
    }
    return active.every(([key, values]) => {
      const value = row.fields[key]
      return value !== undefined && values.has(value)
    })
  })
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
pnpm test -- subtrackRows
```

Expected: PASS, 8 tests.

`filterRows` is exported but not yet tested — Task 5 covers it through the model, where it is actually used. Do not add a redundant direct test.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackSelector/subtrackRows.ts src/SubtrackSelector/subtrackRows.test.ts
git commit -m "Turn the subtrack catalog into faceted rows

Ports JBrowse 1's metadata trick: featureFilters serve as both the
lane-assignment predicate and the facetable columns, so a synteny track's filter
attributes are facets for free -- no metadata service, no adapter, no fetch.
metadata wins a key collision, matching JB1's dojo.mixin argument order.

Facet counts use JBrowse 2's drill-down ordering, where an already-filtered
facet is counted against the pre-filter row set. Without it, selecting a value
zeroes out its own siblings and the user can never widen the selection again."
```

---

## Task 5: The faceted selector model

An MST model that takes rows in and emits an ordered label list out. It must not import anything from `src/SubtrackFeatureDisplay/`.

The selection here is a **working copy**: the dialog is a transaction and nothing reaches the display until Apply.

**Files:**
- Create: `src/SubtrackSelector/facetedSubtrackModel.ts`
- Test: `src/SubtrackSelector/facetedSubtrackModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/SubtrackSelector/facetedSubtrackModel.test.ts`:

```ts
import { facetedSubtrackModelF } from './facetedSubtrackModel'
import { toRows } from './subtrackRows'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  {
    label: 'Pf 3D7',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: '3D7' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: 'HB3' },
    visible: true,
  },
  {
    label: 'Pv Sal-1',
    featureFilters: { organism: 'P. vivax' },
    metadata: { strain: 'Sal-1' },
    visible: false,
  },
]

function make(selected: string[] = ['Pf 3D7']) {
  const model = facetedSubtrackModelF().create({ selected })
  model.setRows(toRows(CATALOG))
  return model
}

describe('facetedSubtrackModel', () => {
  it('exposes facet keys derived from the rows', () => {
    expect(make().facetKeys).toEqual(['organism', 'strain'])
  })

  it('toggling a row on appends it to the end of the lane order', () => {
    const model = make(['Pf 3D7'])

    model.toggle('Pv Sal-1')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pv Sal-1'])
  })

  it('toggling a row off removes it without disturbing the rest', () => {
    const model = make(['Pf 3D7', 'Pf HB3', 'Pv Sal-1'])

    model.toggle('Pf HB3')

    expect(model.selected.slice()).toEqual(['Pf 3D7', 'Pv Sal-1'])
  })

  it('moves a lane to a new position', () => {
    const model = make(['a', 'b', 'c'])

    model.move(2, 0)

    expect(model.selected.slice()).toEqual(['c', 'a', 'b'])
  })

  it('filters rows by text across name and every field', () => {
    const model = make()

    model.setFilterText('vivax')

    expect(model.filteredRows.map(r => r.id)).toEqual(['Pv Sal-1'])
  })

  it('filters rows by facet', () => {
    const model = make()

    model.setFilter('organism', ['P. vivax'])

    expect(model.filteredRows.map(r => r.id)).toEqual(['Pv Sal-1'])
  })

  it('combines a facet filter with a text filter', () => {
    const model = make()

    model.setFilter('organism', ['P. falciparum'])
    model.setFilterText('HB3')

    expect(model.filteredRows.map(r => r.id)).toEqual(['Pf HB3'])
  })

  it('clearing filters restores every row', () => {
    const model = make()
    model.setFilter('organism', ['P. vivax'])
    model.setFilterText('Sal')

    model.clearFilters()

    expect(model.filteredRows).toHaveLength(3)
  })

  it('filtering the table never disturbs the lane order', () => {
    const model = make(['Pv Sal-1', 'Pf 3D7'])

    model.setFilter('organism', ['P. falciparum'])

    // the point of the two-pane design: order is a property of the selected
    // set, not of the catalog view
    expect(model.selected.slice()).toEqual(['Pv Sal-1', 'Pf 3D7'])
  })

  it('reports whether it can be applied', () => {
    expect(make([]).canApply).toBe(false)
    expect(make(['Pf 3D7']).canApply).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm test -- facetedSubtrackModel
```

Expected: FAIL — `Cannot find module './facetedSubtrackModel'`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `src/SubtrackSelector/facetedSubtrackModel.ts`:

```ts
import { types } from '@jbrowse/mobx-state-tree'
import { observable } from 'mobx'

import {
  filterRows,
  getFacetCounts,
  getFacetKeys,
} from './subtrackRows'

import type { SubtrackRow } from './subtrackRows'
import type { Instance } from '@jbrowse/mobx-state-tree'

/**
 * #stateModel FacetedSubtrackModel
 *
 * Rows in, an ordered list of selected ids out. It knows nothing about
 * SubtrackFeatureDisplay, nothing about tracks, and nothing about what a lane
 * is -- the dialog is the only thing that bridges the two.
 *
 * That boundary is not decoration. It is what would let this be replaced by an
 * upstreamed, generic JBrowse 2 FacetedSelector as a deletion rather than a
 * rewrite (see docs/subtrack-selector.md, "Follow-on"). Do not reach into the
 * display from here.
 *
 * `selected` is a WORKING COPY. The dialog is a transaction: nothing touches the
 * display until Apply.
 */
export function facetedSubtrackModelF() {
  return types
    .model('FacetedSubtrackModel', {
      /**
       * #property
       * ordered ids of the selected lanes, top to bottom
       */
      selected: types.array(types.string),
      /**
       * #property
       */
      filterText: types.optional(types.string, ''),
    })
    .volatile(() => ({
      /**
       * #volatile
       */
      rows: [] as SubtrackRow[],
      /**
       * #volatile
       */
      filters: observable.map<string, string[]>(),
    }))
    .actions(self => ({
      /**
       * #action
       */
      setRows(rows: SubtrackRow[]) {
        self.rows = rows
      },
      /**
       * #action
       */
      setFilterText(text: string) {
        self.filterText = text
      },
      /**
       * #action
       */
      setFilter(key: string, values: string[]) {
        self.filters.set(key, values)
      },
      /**
       * #action
       */
      clearFilters() {
        self.filters.clear()
        self.filterText = ''
      },
      /**
       * #action
       * A newly checked lane goes to the bottom, which is the only
       * non-surprising place for it.
       */
      toggle(id: string) {
        const idx = self.selected.indexOf(id)
        if (idx === -1) {
          self.selected.push(id)
        } else {
          self.selected.splice(idx, 1)
        }
      },
      /**
       * #action
       */
      move(from: number, to: number) {
        const [moved] = self.selected.splice(from, 1)
        if (moved !== undefined) {
          self.selected.splice(to, 0, moved)
        }
      },
    }))
    .views(self => ({
      /**
       * #getter
       */
      get facetKeys() {
        return getFacetKeys(self.rows)
      },
      /**
       * #getter
       */
      get filteredRows() {
        return filterRows(self.rows, self.filterText, new Map(self.filters))
      },
      /**
       * #getter
       */
      get selectedSet() {
        return new Set(self.selected)
      },
      /**
       * #getter
       * Zero lanes is not a useful thing to apply, so Apply is disabled rather
       * than silently reverting to defaults the way JBrowse 1 did.
       */
      get canApply() {
        return self.selected.length > 0
      },
    }))
    .views(self => ({
      /**
       * #getter
       */
      get facetCounts() {
        return getFacetCounts(self.rows, self.facetKeys, new Map(self.filters))
      },
    }))
}

export type FacetedSubtrackStateModel = ReturnType<typeof facetedSubtrackModelF>
export type FacetedSubtrackModel = Instance<FacetedSubtrackStateModel>
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
pnpm test -- facetedSubtrackModel
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackSelector/facetedSubtrackModel.ts src/SubtrackSelector/facetedSubtrackModel.test.ts
git commit -m "Add the faceted subtrack model

Rows in, an ordered list of selected ids out. It knows nothing about the display
-- the dialog is the only bridge. That one-way boundary is what would make
adopting an upstreamed generic FacetedSelector a deletion rather than a rewrite,
and it is the coupling JBrowse 1 had and paid for.

selected is a working copy, so the dialog is a transaction and nothing reaches
the display until Apply. Note that filtering the table never disturbs the lane
order -- that is the whole reason for the two-pane design."
```

---

## Task 6: The three panes

Presentational components. Each is `observer`-wrapped and takes the model.

**Files:**
- Create: `src/SubtrackSelector/FacetPanel.tsx`
- Create: `src/SubtrackSelector/SubtrackTable.tsx`
- Create: `src/SubtrackSelector/SelectedLanesPanel.tsx`

No unit tests for these individually — they are thin renderings of model state, and Task 7's RTL test drives all three together, which is where the behaviour that matters actually lives. Do not write shallow snapshot tests of them.

- [ ] **Step 1: Write `FacetPanel.tsx`**

```tsx
import { FormControl, Select, Typography } from '@mui/material'
import { observer } from 'mobx-react'

import type { FacetedSubtrackModel } from './facetedSubtrackModel'

const FacetPanel = observer(function FacetPanel({
  model,
}: {
  model: FacetedSubtrackModel
}) {
  const { facetKeys, facetCounts, filters } = model

  return (
    <div style={{ width: 200, overflowY: 'auto', flexShrink: 0 }}>
      {facetKeys.map(key => {
        const counts = facetCounts.get(key)
        const values = [...(counts?.entries() ?? [])].sort((a, b) =>
          a[0].localeCompare(b[0]),
        )
        return (
          <FormControl key={key} fullWidth style={{ marginBottom: 8 }}>
            <Typography variant="body2">{key}</Typography>
            <Select
              multiple
              native
              size="small"
              value={filters.get(key) ?? []}
              onChange={event => {
                model.setFilter(key, event.target.value as unknown as string[])
              }}
            >
              {values.map(([value, count]) => (
                <option key={value} value={value}>
                  {value} ({count})
                </option>
              ))}
            </Select>
          </FormControl>
        )
      })}
    </div>
  )
})

export default FacetPanel
```

- [ ] **Step 2: Write `SubtrackTable.tsx`**

Virtualized, because a synteny catalog can run to hundreds of rows. JBrowse 2 hand-rolls this rather than pulling in a grid library; we do the same.

```tsx
import { useRef, useState } from 'react'

import { Checkbox } from '@mui/material'
import { observer } from 'mobx-react'

import type { FacetedSubtrackModel } from './facetedSubtrackModel'

const ROW_HEIGHT = 28
const OVERSCAN = 10

const SubtrackTable = observer(function SubtrackTable({
  model,
}: {
  model: FacetedSubtrackModel
}) {
  const { filteredRows, facetKeys, selectedSet } = model
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(
    filteredRows.length,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
  )
  const visible = filteredRows.slice(start, end)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        ref={ref}
        style={{ flex: 1, overflow: 'auto' }}
        onScroll={e => {
          setScrollTop(e.currentTarget.scrollTop)
          setHeight(e.currentTarget.clientHeight)
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'inherit' }}>
            <tr>
              <th style={{ width: 40 }} />
              <th style={{ textAlign: 'left' }}>Name</th>
              {facetKeys.map(key => (
                <th key={key} style={{ textAlign: 'left' }}>
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: start * ROW_HEIGHT }} />
            {visible.map(row => (
              <tr key={row.id} style={{ height: ROW_HEIGHT }}>
                <td>
                  <Checkbox
                    size="small"
                    inputProps={{ 'aria-label': row.name }}
                    checked={selectedSet.has(row.id)}
                    onChange={() => {
                      model.toggle(row.id)
                    }}
                  />
                </td>
                <td>{row.name}</td>
                {facetKeys.map(key => (
                  <td key={key}>{row.fields[key] ?? ''}</td>
                ))}
              </tr>
            ))}
            <tr style={{ height: (filteredRows.length - end) * ROW_HEIGHT }} />
          </tbody>
        </table>
      </div>
      <Typography variant="caption">
        {filteredRows.length} matching subtrack
        {filteredRows.length === 1 ? '' : 's'}
      </Typography>
    </div>
  )
})

export default SubtrackTable
```

Add `Typography` to the `@mui/material` import.

The `aria-label` on the checkbox is load-bearing: Task 7's test finds rows by it.

- [ ] **Step 3: Write `SelectedLanesPanel.tsx`**

Native HTML5 drag, no dependency. dnd-kit is not on core's ReExports list so adopting it means bundling it, and this is a short list of chosen lanes, not a kanban board.

```tsx
import { useState } from 'react'

import { Typography } from '@mui/material'
import { observer } from 'mobx-react'

import type { FacetedSubtrackModel } from './facetedSubtrackModel'

const SelectedLanesPanel = observer(function SelectedLanesPanel({
  model,
}: {
  model: FacetedSubtrackModel
}) {
  const [dragging, setDragging] = useState<number | undefined>(undefined)

  return (
    <div style={{ width: 200, overflowY: 'auto', flexShrink: 0 }}>
      <Typography variant="body2">Lanes (drag to reorder)</Typography>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="lanes">
        {model.selected.map((id, index) => (
          <li
            key={id}
            draggable
            data-testid={`lane-${id}`}
            onDragStart={() => {
              setDragging(index)
            }}
            onDragOver={e => {
              e.preventDefault()
            }}
            onDrop={e => {
              e.preventDefault()
              if (dragging !== undefined && dragging !== index) {
                model.move(dragging, index)
              }
              setDragging(undefined)
            }}
            style={{ cursor: 'grab', padding: '2px 4px' }}
          >
            ⠿ {id}
          </li>
        ))}
      </ul>
      {model.selected.length === 0 ? (
        <Typography variant="caption" color="error">
          Select at least one subtrack
        </Typography>
      ) : null}
    </div>
  )
})

export default SelectedLanesPanel
```

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm typecheck && npx eslint src/SubtrackSelector
```

Expected: clean. Fix anything `noUncheckedIndexedAccess` complains about. Do not
run `pnpm lint` — it is red at baseline for unrelated reasons.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackSelector/FacetPanel.tsx src/SubtrackSelector/SubtrackTable.tsx src/SubtrackSelector/SelectedLanesPanel.tsx
git commit -m "Add the three panes of the subtrack selector

Facets on the left, virtualized catalog table in the middle, ordered lane list
on the right. Drag-and-drop is native HTML5 rather than dnd-kit, which is not on
core's ReExports list and so would have to be bundled -- this is a short list of
chosen lanes, not a kanban board."
```

---

## Task 7: The dialog, and the transaction boundary

The only file that touches the display. Its test asserts the one thing not provable from the parts: **Apply commits the ordered selection, Cancel commits nothing.**

**Files:**
- Create: `src/SubtrackSelector/SubtrackSelectorDialog.tsx`
- Test: `src/SubtrackSelector/SubtrackSelectorDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/SubtrackSelector/SubtrackSelectorDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'

import SubtrackSelectorDialog from './SubtrackSelectorDialog'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

const CATALOG: Subtrack[] = [
  {
    label: 'Pf 3D7',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: '3D7' },
    visible: true,
  },
  {
    label: 'Pf HB3',
    featureFilters: { organism: 'P. falciparum' },
    metadata: { strain: 'HB3' },
    visible: false,
  },
]

function makeDisplay() {
  return {
    subtrackCatalog: CATALOG,
    subtrackSelection: undefined as string[] | undefined,
    setSubtrackSelection: jest.fn(),
    resetSubtrackSelection: jest.fn(),
  }
}

describe('SubtrackSelectorDialog', () => {
  it('starts from the catalog defaults when the user has not chosen', () => {
    const display = makeDisplay()
    render(<SubtrackSelectorDialog display={display} handleClose={jest.fn()} />)

    // Pf HB3 is visible:false, so only Pf 3D7 is a lane to begin with
    expect(screen.getByTestId('lane-Pf 3D7')).toBeInTheDocument()
    expect(screen.queryByTestId('lane-Pf HB3')).not.toBeInTheDocument()
  })

  it('checking a row adds it to the lanes pane', () => {
    const display = makeDisplay()
    render(<SubtrackSelectorDialog display={display} handleClose={jest.fn()} />)

    fireEvent.click(screen.getByLabelText('Pf HB3'))

    expect(screen.getByTestId('lane-Pf HB3')).toBeInTheDocument()
  })

  it('Apply commits the ordered selection and closes', () => {
    const display = makeDisplay()
    const handleClose = jest.fn()
    render(
      <SubtrackSelectorDialog display={display} handleClose={handleClose} />,
    )

    fireEvent.click(screen.getByLabelText('Pf HB3'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(display.setSubtrackSelection).toHaveBeenCalledWith([
      'Pf 3D7',
      'Pf HB3',
    ])
    expect(handleClose).toHaveBeenCalled()
  })

  it('Cancel commits nothing', () => {
    const display = makeDisplay()
    const handleClose = jest.fn()
    render(
      <SubtrackSelectorDialog display={display} handleClose={handleClose} />,
    )

    fireEvent.click(screen.getByLabelText('Pf HB3'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // this is the assertion that keeps the selector honest about not reaching
    // into the display: the working copy changed, the display did not
    expect(display.setSubtrackSelection).not.toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })

  it('disables Apply when nothing is selected', () => {
    const display = makeDisplay()
    render(<SubtrackSelectorDialog display={display} handleClose={jest.fn()} />)

    fireEvent.click(screen.getByLabelText('Pf 3D7'))

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('Reset clears the selection back to config defaults and closes', () => {
    const display = makeDisplay()
    const handleClose = jest.fn()
    render(
      <SubtrackSelectorDialog display={display} handleClose={handleClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(display.resetSubtrackSelection).toHaveBeenCalled()
    expect(display.setSubtrackSelection).not.toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })
})
```

Note the display is a plain object, not an MST model. That is the boundary working: the dialog needs only `subtrackCatalog`, `subtrackSelection`, `setSubtrackSelection` and `resetSubtrackSelection`, so it can be tested without a `PluginManager`, without the LGV plugin, and without a session.

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm test -- SubtrackSelectorDialog
```

Expected: FAIL — `Cannot find module './SubtrackSelectorDialog'`.

- [ ] **Step 3: Implement the minimal code to make the test pass**

Create `src/SubtrackSelector/SubtrackSelectorDialog.tsx`:

```tsx
import { useState } from 'react'

import { Dialog } from '@jbrowse/core/ui'
import { Button, DialogActions, DialogContent, TextField } from '@mui/material'
import { observer } from 'mobx-react'

import FacetPanel from './FacetPanel'
import SelectedLanesPanel from './SelectedLanesPanel'
import SubtrackTable from './SubtrackTable'
import { facetedSubtrackModelF } from './facetedSubtrackModel'
import { toRows } from './subtrackRows'
import { resolveSubtracks } from '../SubtrackFeatureDisplay/resolveSubtracks'

import type { Subtrack } from '../SubtrackFeatureRenderer/subtrackUtils'

/**
 * All the dialog needs of the display. Deliberately structural rather than the
 * MST type: the selector must not depend on SubtrackFeatureDisplay, and this
 * keeps the test able to pass a plain object.
 */
export interface SubtrackSelectorTarget {
  subtrackCatalog: Subtrack[]
  subtrackSelection: string[] | undefined
  setSubtrackSelection: (labels: string[]) => void
  resetSubtrackSelection: () => void
}

const SubtrackSelectorDialog = observer(function SubtrackSelectorDialog({
  display,
  handleClose,
}: {
  display: SubtrackSelectorTarget
  handleClose: () => void
}) {
  // one working copy, created once. The dialog is a transaction: nothing
  // touches the display until Apply.
  const [model] = useState(() => {
    const catalog = display.subtrackCatalog
    const initial = resolveSubtracks(
      catalog,
      display.subtrackSelection ? [...display.subtrackSelection] : undefined,
    ).map(s => s.label)

    const m = facetedSubtrackModelF().create({ selected: initial })
    m.setRows(toRows(catalog))
    return m
  })

  return (
    <Dialog open onClose={handleClose} title="Select subtracks" maxWidth="lg">
      <DialogContent>
        <TextField
          size="small"
          fullWidth
          placeholder="Contains text"
          value={model.filterText}
          onChange={e => {
            model.setFilterText(e.target.value)
          }}
        />
        <div style={{ display: 'flex', gap: 8, height: 450, marginTop: 8 }}>
          <FacetPanel model={model} />
          <SubtrackTable model={model} />
          <SelectedLanesPanel model={model} />
        </div>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            model.clearFilters()
          }}
        >
          Clear filters
        </Button>
        <Button
          onClick={() => {
            display.resetSubtrackSelection()
            handleClose()
          }}
        >
          Reset to defaults
        </Button>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!model.canApply}
          onClick={() => {
            display.setSubtrackSelection([...model.selected])
            handleClose()
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  )
})

export default SubtrackSelectorDialog
```

`Dialog` comes from `@jbrowse/core/ui`, which **is** on core's ReExports list, so it resolves to the host's single copy and costs nothing in the bundle. Same for `@mui/material`.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
pnpm test -- SubtrackSelectorDialog
```

Expected: PASS, 6 tests. If `toBeInTheDocument` is not recognised, confirm `@testing-library/jest-dom` is in the jest setup file; it is already a devDependency.

- [ ] **Step 5: Commit**

```bash
git add src/SubtrackSelector/SubtrackSelectorDialog.tsx src/SubtrackSelector/SubtrackSelectorDialog.test.tsx
git commit -m "Add the subtrack selector dialog

The only file that touches the display, and it does so through a structural
interface of four members rather than the MST type -- so the test drives the
whole dialog with a plain object, no PluginManager, no LGV plugin, no session.

The test that matters is the transaction boundary: Apply commits the ordered
selection, Cancel commits nothing. Apply is disabled at zero lanes rather than
silently reverting to defaults the way JBrowse 1 did, which lied about what it
had done."
```

---

## Task 8: Wire it to the track menu

**Files:**
- Modify: `src/SubtrackFeatureDisplay/model.ts`

- [ ] **Step 1: Add the menu item**

Add to the imports in `src/SubtrackFeatureDisplay/model.ts`:

```ts
import { getConf } from '@jbrowse/core/configuration'
import { getSession } from '@jbrowse/core/util'

import SubtrackSelectorDialog from '../SubtrackSelector/SubtrackSelectorDialog'
```

(`getConf` is already imported — do not duplicate it.)

Add a new `.views` block, chained **after** the block that defines `resolvedSubtracks`, capturing the base implementation the same way the existing `renderProps` override captures `superRenderProps`:

```ts
    .views(self => {
      const superTrackMenuItems = self.trackMenuItems
      return {
        /**
         * #method
         */
        trackMenuItems() {
          return [
            ...superTrackMenuItems(),
            ...(getConf(self as any, ['renderer', 'subtrackConfig', 'enabled'])
              ? [
                  {
                    label: 'Select subtracks…',
                    onClick: () => {
                      getSession(self).queueDialog(handleClose => [
                        SubtrackSelectorDialog,
                        { display: self, handleClose },
                      ])
                    },
                  },
                ]
              : []),
          ]
        },
      }
    })
```

The guard means the menu item only appears on tracks that actually use subtracks. `subtrackConfig.enabled` defaults to `false` and turning subtracks on requires setting it explicitly, so it is always present in the stripped config snapshot — see the orientation note about `getConf` on nested schemas.

`self as any` is needed because `BaseLinearDisplay` arrives untyped from the LGV plugin's `exports`; the existing `rendererConfig` getter already does this and explains why.

- [ ] **Step 2: Verify the whole suite and the bundle**

```bash
pnpm test && pnpm typecheck && pnpm build
npx eslint src/SubtrackSelector src/SubtrackFeatureDisplay
```

Expected: all tests pass (80 baseline + 11 + 3 + 8 + 10 + 6 = 118), typecheck
clean, scoped eslint clean, rollup produces `dist/*.umd.development.js`.

Task 1 ended up with 11 tests rather than the 8 planned — code review found that
`dedupeCatalog`'s `console.warn` fires inside a MobX computed (see
`resolvedSubtracks`, Task 3), so it needed a content-keyed warn-once throttle
plus tests. Hence the count.

- [ ] **Step 3: Commit**

```bash
git add src/SubtrackFeatureDisplay/model.ts
git commit -m "Put the subtrack selector on the track menu

Guarded on subtrackConfig.enabled, so the item only appears on tracks that
actually use subtracks. queueDialog is the JB2 idiom; Dialog comes from
@jbrowse/core/ui, which is a ReExport, so the host's single copy is used."
```

---

## Task 9: Verify it in a real browser

Unit tests cannot tell you whether the lanes actually redraw. Two terminals, both on Node 22.

- [ ] **Step 1: Serve the plugin bundle**

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22
cd /home/jbrestel/jbrowse2/jbrowse-plugin-subtrack-renderer/.worktrees/subtrack-selector
pnpm build
npx serve --cors --listen 9002 .
```

- [ ] **Step 2: Serve jbrowse-web**

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22
cd /home/jbrestel/jbrowse2/jbrowse-components/products/jbrowse-web
pnpm start
```

- [ ] **Step 3: Load the existing two-plugin test config**

`jbrowse-components/products/jbrowse-web/public/subtrack-plugin-test.json` already points at port 9002 for this plugin. Open it and navigate to a region with features.

- [ ] **Step 4: Check each of these by hand**

Confirm, and write down what you saw:

1. "Select subtracks…" appears on the subtrack track's menu, and does **not** appear on a plain feature track's menu.
2. The dialog opens with exactly the lanes that were already drawn, pre-checked.
3. Unchecking a lane and pressing Apply makes that lane disappear **across the whole visible region**, not just in one block. Pan left and right to confirm no block is left drawing the old lane set.
4. Dragging a lane in the right-hand pane and pressing Apply reorders the lanes on screen, and the lane labels line up with the right features.
5. Zoom in and out. The lanes stay mutually aligned and heights still converge — the `laneHeights` reaction must still work with the new lane set.
6. Facet-filter the table (e.g. by organism), then check a row. Confirm the lane order in the right-hand pane is undisturbed by the filtering.
7. Cancel after making changes leaves the drawing untouched.
8. "Reset to defaults" restores the config's default lanes.
9. Reload the page with the session in the URL. The selection survives. **This is the thing JBrowse 1 could never do**, so it is worth confirming deliberately.

- [ ] **Step 5: Commit any fixes, then finish the branch**

If anything above fails, fix it, add a regression test, and commit. When all nine pass, use the **superpowers:finishing-a-development-branch** skill to decide how to integrate `feature/subtrack-selector` back into `init-dev`.

---

## Notes for the follow-on upstream spec

Do not write it as part of this plan. Once `facetedSubtrackModel` exists and works, it is the evidence for the ask described in `docs/subtrack-selector.md` ("Follow-on"): make `FacetedModel` generic over row type, give `FacetedDataGrid` `selectedIds`/`onToggle` props instead of reaching into `HierarchicalTrackSelectorModel`, and add both to `DataManagementPlugin.exports`. Pair it with `docs/upstream-canvas-extensibility.md`, which asks for an exports block on `CanvasPlugin` for the same class of reason.
