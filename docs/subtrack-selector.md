# Subtrack selector: choosing and ordering lanes

Status: **implemented and merged to init-dev** (2026-07-11)
Date: 2026-07-11

Verified end to end in jbrowse-web against an 8-lane Volvox catalog
(`test_config/subtrack-selector-test.json`): the menu item appears only when
`subtrackConfig.enabled`; the dialog opens on the catalog defaults; a newly
checked lane slots into catalog position rather than click position; filtering
the table leaves the lane order untouched; Apply redraws **every** block at once
(all three canvases went 240px -> 320px together); Cancel discards; Reset returns
to the config defaults; and the selection **survives a page reload** via the
session snapshot.

Two things the design did not anticipate, both found in the browser and fixed:
the checkboxes had no accessible name at runtime (`inputProps` is gone in the
host's MUI 9, while jest renders against the plugin's MUI 7 -- see the MUI note
in the workspace CLAUDE.md), and upstream's facet-count algorithm is wrong for
two or more active facets (see Edge cases).

## The problem

`SubtrackFeatureDisplay` draws one lane per entry in the renderer config's
`subtracks` array. Which lanes appear, and in what order, is fixed at config
time. The user cannot turn a lane off, cannot turn a lane on, and cannot move
one. For a synteny track with a few hundred candidate subtracks that is not a
browser, it is a screenshot.

JBrowse 1 solved the first half of this and only pretended to solve the second.

## What JBrowse 1 actually did

`JBrowse1_VEuPathPlugins/plugins/EbrcTracks/js/View/Track/CanvasSubtracks.js`
plus `.../View/TrackList/FacetedSubtracks.js`.

Subtrack metadata came from nowhere but the track config. `CanvasSubtracks`
reads `getConf('subtracks')` -- an array of
`{label, featureFilters, metadata, visible}` -- and synthesizes one pseudo-track
config per subtrack:

```js
var allmetadata = dojo.mixin({ id: i+1, label: label },
                             featureFilters, metadata,
                             { defaultChecked: defaultChecked });
data.push({ key: i+1, label: label, metadata: allmetadata });
```

That array is handed to JBrowse 1's *stock* `JBrowse/Store/TrackMetaData`, which
derives facets from the metadata keys automatically. `FacetedSubtracks` is a
copy of the stock faceted track selector with the grid rows meaning subtracks
rather than tracks.

The load-bearing trick, and the reason this design keeps it: **`featureFilters`
do double duty.** They are the predicate that assigns a feature to a lane *and*
the facetable columns of the selector. Whatever attribute you filter a synteny
subtrack by is automatically an attribute you can filter the selector on. No
metadata service, no adapter, no fetch.

Ordering, on the other hand, never worked. The `dojox` DnD grid plugin is
imported and commented out (`FacetedSubtracks.js:12`, `CanvasSubtracks.js:19`),
and the save handler's comparator is missing a `return`:

```js
var sortedSelectedSubtracks = selected.sort(function(a,b) {
    facetedSubtracks.dataGrid.getItemIndex(a) - facetedSubtracks.dataGrid.getItemIndex(b);
});
```

so it is a no-op and lane order has always been config order. We are not porting
ordering. We are building it.

## Why we cannot reuse JBrowse 2's faceted selector

`plugins/data-management/src/FacetedSelector/` looks like exactly what we want,
and is not reachable:

- `DataManagementPlugin.exports` publishes only `AssemblyManager`, so there is
  no runtime channel to it.
- `@jbrowse/plugin-data-management` is not on core's ReExports list, so a value
  import makes rollup bundle a private duplicate of the whole plugin.
- Even with the bundle, it would not work. `FacetedDataGrid` is hardwired to
  `HierarchicalTrackSelectorModel` and calls `view.showTrack(row.id)` -- for a
  subtrack there is no such track id. `FacetedModel.allRows` is hardwired to
  `AnyConfigurationModel` (`trackId`, `getTrackName`, `category`, `adapter`).

So we port the *pattern*, not the code -- the same call JBrowse 1 made. See
"Follow-on" for the upstream fix.

## Design

### The config declares, the display decides

`subtracks` stays exactly where it is, a `frozen` slot on the
`SubtrackFeatureRenderer` schema, and becomes purely a **catalog**: every
subtrack that *could* be shown. Nothing mutates it. `visible` now means
*default-on*, JBrowse 1's `defaultChecked`. Existing configs need no migration.

`SubtrackFeatureDisplay` gains one MST property:

```ts
subtrackSelection: types.maybe(types.array(types.string))  // ordered labels of visible lanes
```

One property carries both selection and order, because for a lane list they are
the same thing: the visible subtracks, top to bottom. `undefined` means "no user
choice yet, defer to the catalog". Being an MST property it lands in the session
snapshot for free, so a shared session URL carries the user's lane selection --
something the JBrowse 1 version could never do, since its `track.subtracks` was
plain instance state.

Resolution:

```ts
get resolvedSubtracks(): Subtrack[] {
  const byLabel = new Map(self.subtrackCatalog.map(s => [s.label, s]))
  return self.subtrackSelection
    ? self.subtrackSelection.map(l => byLabel.get(l)).filter(notEmpty)
    : self.subtrackCatalog.filter(s => s.visible !== false)
}
```

Dropping labels absent from the catalog is the whole upgrade story: removing a
subtrack from the config retires it from stale sessions instead of crashing
them.

### Publishing to the renderer

`renderProps()` gains `subtracks: self.resolvedSubtracks` alongside the existing
`subtrackLaneHeights`, and the renderer prefers it over
`readConfObject(config, 'subtracks')`.

This costs nothing to build: core's `renderBlockData()` calls `renderProps()`
inside a mobx reaction, so changing the selection invalidates *every* block at
once and the whole visible region redraws with the new lane set. No `reload()`.
It is the same mechanism `laneHeights` already uses, and it is the supported way
to refresh the visible region.

The lane-height reaction re-converges in its usual two passes. Stale labels drop
out of `laneHeights` on their own, because `requiredLaneHeights` rebuilds the map
fresh from what the blocks report rather than accumulating.

Consequence worth naming: once the display hands the renderer a pre-filtered,
pre-ordered list, the renderer's own `subtrack.visible === false` checks in
`subtrackUtils.ts` become dead on the live path. Leave them -- they keep the
renderer standalone-testable and the image snapshots green -- but stop treating
them as the mechanism.

### The selector

Two-pane, because **order is a property of the selected set, not of the
catalog**. Filtering the table must never disturb the lane order, and dragging
eight chosen lanes beats dragging within three hundred filtered rows.

```
┌─ Select Subtracks ────────────────────────────────────┐
│ Filters   │ ☑ Name        Organism   Strain    │ Lanes │
│ Organism  │ ☑ P.f 3D7     P.falcip.  3D7       │ ∷ 3D7 │
│  [x] P.f  │ ☐ P.f Dd2     P.falcip.  Dd2       │ ∷ HB3 │
│  [ ] P.v  │ ☑ P.f HB3     P.falcip.  HB3       │ ∷ IT  │
│ Strain    │ ☑ P.f IT      P.falcip.  IT        │       │
│  ...      │ ☐ P.v Sal-1   P.vivax    Sal-1     │ (drag)│
│           │         142 matching subtracks     │       │
└───────────────────────────────────────────────────────┘
                                    [ Cancel ]  [ Apply ]
```

New directory, deliberately knowing nothing about `SubtrackFeatureDisplay`:

```
src/SubtrackSelector/
  facetedSubtrackModel.ts     MST: rows in, filters + ordered selection out
  subtrackRows.ts             pure: catalog -> rows, facet keys, facet counts
  SubtrackSelectorDialog.tsx  three panes + Cancel/Apply
  FacetPanel.tsx              left: one <Select multiple native> per facet, with counts
  SubtrackTable.tsx           center: checkbox + metadata columns, virtualized
  SelectedLanesPanel.tsx      right: ordered, draggable list of checked labels
```

**Rows and facets.** `subtrackRows.ts` turns the catalog into
`{id: label, name: label, fields: Record<string, string>}` where `fields` is
`{...featureFilters, ...metadata}` -- metadata wins on key collision, matching
JBrowse 1's `dojo.mixin` argument order. Facet keys are the union of
primitive-valued keys across all rows, which is both `getRootKeys`' rule in
JBrowse 2 and JBrowse 1's `colNames` loop.

So a `featureFilters: {type: ['gene','mRNA']}` or a `{min, max}` range still
assigns features to a lane, it just is not facetable. That is the right trade:
those are predicates, not descriptors, and stringifying them would produce
garbage columns.

**Facet counts** use JBrowse 2's drill-down ordering (see `FacetFilters.tsx`):
facets with an active filter are counted against the *pre-filter* row set, so
selecting a value does not zero out its own siblings. This is the non-obvious
part and is worth copying exactly.

**Working copy.** The faceted model holds `filterText`, `showSparse`, a
`filters: observable.map<string, string[]>`, and its own copy of the ordered
selection. The dialog is a transaction: nothing touches the display until Apply.

**Drag and drop** is native HTML5 `draggable` + `dragover`/`drop`, roughly 40
lines. dnd-kit is not on core's ReExports list, so adopting it means bundling
it, and we are reordering a handful of lanes, not building a kanban board. The
centre table borrows the `useVirtualRows` approach from JBrowse 2's
`FacetedDataGrid` (which hand-rolls a 40-line hook rather than using a grid
library) because a synteny catalog can run to hundreds of rows.

We copy `findNonSparseKeys` and `getRootKeys` from `facetedUtil.ts` -- 26 lines
total, not worth a dependency.

### Data flow

One direction only:

```
display.subtrackCatalog ──▶ subtrackRows() ──▶ facetedSubtrackModel
                                                   │  (check / filter / drag)
                                                   ▼
                                          faceted.selectedLabels: string[]
                                                   │  Apply
                                                   ▼
                                display.setSubtrackSelection(labels)
                                                   │
                                                   ▼
                            renderProps().subtracks ──▶ every block re-renders
```

The selector never calls back into the display, never touches a track, and never
knows what a lane is. That boundary is not decoration: it is what makes the
follow-on upstream work cheap, because the model already takes rows and emits an
ordered id list, which is precisely the generic interface upstream needs. It is
also the coupling JBrowse 1 had and paid for -- its save handler reached into
`track.subtracks`, `track._clearLayout()`, `track.destroySublabels()`,
`track.makeTrackSubLabels()` and `track.redraw()` by hand.

### Menu wiring

```ts
trackMenuItems() {
  return [
    ...superTrackMenuItems(),
    ...(getConf(self, ['renderer', 'subtrackConfig', 'enabled'])
      ? [{
          label: 'Select subtracks…',
          onClick: () => getSession(self).queueDialog(handleClose => [
            SubtrackSelectorDialog, { model: self, handleClose },
          ]),
        }]
      : []),
  ]
}
```

`queueDialog` is on `AbstractSessionModel`; `Dialog` comes from
`@jbrowse/core/ui`, which *is* a ReExport, as is `@mui/material`. So dialog
chrome, MUI and mobx all come from the host's single copy and the bundle grows
by our ~500 lines and nothing else.

## Edge cases

**Empty selection.** JBrowse 1 popped `alert("Nothing was selected")` and then
silently reverted to defaults -- the worst option, because it lies about what it
did. Apply is disabled at zero lanes, with helper text.

**Catalog drift.** Labels absent from the catalog are dropped on resolve.
Subtracks *added* to the config after a session was saved do not silently appear;
the user's explicit choice wins. "Reset to defaults" (sets `subtrackSelection`
back to `undefined`) is the escape hatch.

**Duplicate labels.** Label is already the de facto primary key: `laneHeights` is
keyed by it, `buildLayoutKey()` composes it into the layout key, and
`getFeatureSubtrack` matches on it. A duplicate today silently corrupts lane
geometry. We are now also making it the row id and the selection token, so:
dedupe on catalog read, warn once. This is a latent bug we are not introducing,
but should stop pretending is not there.

**Hiding a lane can move features rather than remove them.** `getFeatureSubtrack`
returns the *first* matching subtrack, so a feature matching both "Genes" and a
catch-all lane does not disappear when "Genes" is deselected -- it re-bins into
the catch-all. Deselecting means "remove this lane from the matching order", not
"hide these features". JBrowse 1 behaved identically, so this is faithful to the
port, but it will surprise a user and is worth saying out loud.

**Facet counts: we deliberately diverge from upstream.** JBrowse 2's
`FacetFilters.tsx` narrows the row set sequentially as it walks the active
facets, so facet *i* is counted against rows filtered by facets *1..i-1* only,
missing the filters of *i+1..n*. Only the **last** active facet gets correct
counts, and which one that is depends on alphabetical key order. With two facets
active, a value can advertise a count of 2 and return 1 row when clicked. Sibling
counts are what the user steers by, so a count that lies is worse than no count.
Our `getFacetCounts` counts each facet against the rows surviving every *other*
active filter: order-independent and correct. **A knowing divergence, not a
porting error** -- see the Follow-on.

## Filter, sort, and select are three independent operations

This is the property from JBrowse 1 that most needed preserving, and the one its
ordering bug obscured.

**Filtering never touches the selection.** Facet filters and the text search feed
`filteredRows`, which is *only* what the table displays. Check a lane, then filter
it out of view, and it stays checked, stays in the Lanes pane, and stays in its
position. Enforced by a test (`filtering the table never disturbs the lane order`).
The one place the selection is pruned is `setRows`, which runs once on open against
the full catalog, never against the filtered view.

**Sorting never touches the selection or the catalog order.** Column sort is a
browsing aid for a long catalog. It reorders `displayRows` -- a view -- and must
never reorder `rows`, which stays in catalog order permanently, because catalog
order is the reference frame the default lane order depends on.

**Lane order defaults to catalog order, and drag overrides it.** JBrowse 1 ordered
lanes by the sequence in which their checkboxes were clicked, which is arbitrary
and was invisible until you closed the dialog. Instead:

- while the selection is still in catalog order, a newly checked lane slots into
  its catalog position;
- once the user has dragged anything, the selection is a hand-made arrangement,
  so a newly checked lane appends to the bottom, where it is visible and can be
  dragged. Any catalog-derived insertion point would be arbitrary at that point,
  and silently disturbing a manual arrangement is worse than appending.

The Lanes pane makes the resulting order visible at all times, which is the real
fix -- JBrowse 1's order was not just arbitrary, it was unseen.

## Testing

Pure functions carry the logic and get plain unit tests:

- `resolveSubtracks(catalog, selection)` -- defaults, explicit order,
  unknown-label dropping, dedupe.
- `subtrackRows.ts` -- facet-key derivation from the union of `featureFilters`
  and `metadata`, metadata-wins collision, non-primitive skipping, drill-down
  facet counts.

The faceted model gets MST-level tests: check a row, drag, read back
`selectedLabels`. No React required.

The dialog gets one React Testing Library test for the thing not provable from
the parts: checking a row puts it in the lanes pane, dragging reorders it, and
**Apply calls `setSubtrackSelection` with the ordered labels while Cancel does
not**. That is the transaction boundary, and it is the assertion that keeps the
selector honest about not reaching into the display.

Existing renderer image snapshots stay green untouched, because the renderer
still falls back to `readConfObject(config, 'subtracks')` when no `subtracks`
renderProp arrives.

Not tested: that changing the selection redraws every block. That is core's
`renderBlockData()` reaction, already proven by `laneHeights`, and a test of it
would be a test of JBrowse rather than of us.

## Follow-on: upstream (approach B)

`facetedSubtrackModel` is the working proof that JBrowse 2's faceted selector is
not really track-specific. Once it exists, write a spec asking GMOD for:

- `FacetedModel` generic over row type, rather than mapping
  `AnyConfigurationModel` in `allRows`.
- `FacetedDataGrid` taking `selectedIds` and `onToggle` props instead of reaching
  into `HierarchicalTrackSelectorModel` and calling `view.showTrack`/`hideTrack`.
- Both added to `DataManagementPlugin.exports`.

This pairs naturally with `docs/upstream-canvas-extensibility.md`, which asks for
an exports block on `CanvasPlugin` for the same class of reason. We did not block
this feature on that review cycle, and we should not: but the boundary above is
maintained specifically so that adopting the upstream version later is a deletion,
not a rewrite.
