# Subtracks on JBrowse 5: design

**Date:** 2026-09-16
**Status:** approved, pre-implementation
**Supersedes:** the JBrowse 4.3.0 implementation on `init-dev` (PR #1)

## Why this is a rewrite, not a port

JBrowse 5 deleted the block-based rendering system. `addRendererType`,
`ServerSideRendererType`, `BoxRendererType`, `FeatureRendererType`, `GlyphType`,
`PrecomputedLayout` and `MultiLayout` are gone, recorded as removed ABI in
`packages/core/src/ReExports/abiPreviousRelease.json`. `upgrading_v5.md` states
there is no compatibility shim.

The v4 plugin was built on all of it. 7,168 of its 9,225 lines were a verbatim
fork of core's `CanvasFeatureRenderer`, forked because v4 exposed no way to
reuse that renderer.

## The finding that shrank this work

v5 already ships most of the subtrack feature, as
`LinearBasicDisplay.groupBy` — "in-track stacked grouping". It provides:

| Capability | Where |
| --- | --- |
| Stacked labelled sections, full gene glyphs | `LinearBasicDisplay` |
| Per-section row packing | `layout.ts`, `applyLayout.ts` |
| Section labels | `components/GroupLabelsLayer.tsx` |
| Section show/hide, wired to layout and heights | `hiddenGroupKeys` (`baseModel.ts`) |
| Section menu, with a hook for dialog-driven dimensions | `@jbrowse/display-kit/groupByMenu` |
| Stable cross-region section order, cap and overflow | `@jbrowse/core/util/groupKeys` |

Upstream has also already reasoned about the relationship to its sibling
display (`groupBy.ts:47`):

> The multi-row display's `partitionField` is the same partition with one fixed
> row per value; a section here packs its own rows.

Subtracks are the second of those. We are not building subtracks; we are
supplying the one partition rule v5 lacks — lane membership by arbitrary
filter — and the lane-selection UI.

## Architecture

```
jbrowse-components          UNMODIFIED upstream v5. No fork.
  └─ LinearBasicDisplay.groupBy {type:'attribute', attribute:'subtrack'}

jbrowse-plugin-subtrack-renderer
  ├─ SubtrackAdapter        wraps a sub-adapter, stamps `subtrack` per feature
  ├─ resolveSubtracks       catalog + selection -> lanes + hidden keys
  ├─ SubtrackSelector       faceted lane-picker dialog
  └─ extendDisplayType      menu entry -> dialog -> groupBy + hiddenGroupKeys

VEuPathDB track configs     organism/InterPro/junction specifics. Config, not code.
```

### Why an adapter rather than a display

`FeatureGroupBy` is a closed union, but its consumers are what matter:
`layout.ts`, `applyLayout.ts`, `baseModel.ts`, `heightViews.ts`,
`fitLadderViews.ts`, `renderSvg.tsx`, `GroupLabelsLayer.tsx`. Owning the union
means owning the layout path, which is the 4,100-line fork we are escaping.

The `attribute` dimension already partitions on a per-feature string, and
`groupKeyOf` reads it with a plain `feature.get(attribute)`. An adapter that
stamps that string therefore needs no core change at all. Adapters run in the
worker, which is where `groupKeyOf` runs, so the decoration lands exactly where
it is read. `addAdapterType` survives v5, `getSubAdapter` has in-tree precedent
(`MultiWiggleAdapter`), and `dataAdapterCache` is on the ReExports list, so this
is reachable from an external UMD plugin.

## Components

### SubtrackAdapter

Wraps a configured sub-adapter. `getRefNames` delegates. `getFeatures`
delegates, then decorates each feature with a `subtrack` attribute: the label of
the first lane whose filter matches, or absent for no match (which becomes the
`''` catch-all section).

Config: `{ subadapter, lanes: [{ label, featureFilters, metadata, visible }] }`.

Filter semantics carry over from v4 `featureMatchesSubtrack`: a
`Record<string, any>` where all entries must match, values compare by equality
except `{min,max}` objects which are half-open numeric ranges.

**Depends on:** the sub-adapter's feature stream. **Used by:** the track config.

### resolveSubtracks — salvaged verbatim

`(catalog, selection) => orderedLanes`. Zero JBrowse imports, so it ports
unchanged with its tests. Dedupes on label (labels are lane identity), drops
selections absent from the catalog so a retired lane degrades a stale session
gracefully, and falls back to catalog defaults when the user has not chosen.

**Visibility is display-side only.** The adapter stamps every lane in the
catalog, regardless of selection; hiding is purely `hiddenGroupKeys` on the
display. This is not a detail — the adapter cache keys on the config object, so
rewriting the adapter's lane list on each toggle would fork the cache and
re-parse the file per toggle. Stamping everything once means a lane toggle costs
a relayout and no RPC.

### SubtrackSelector — salvaged, ported

The faceted lane picker: text search plus per-facet drill-down over lane
`metadata`, a selected-lanes panel, ordering. `subtrackRows.ts` opens "Generic
faceted-table primitives. Nothing in this file knows what a subtrack is" and
that stays true.

Facets are the part with no upstream equivalent: v5's sections are derived from
data, so they carry no declared per-lane metadata to facet on.

**Port risk:** MUI 7 -> 9. See Testing.

### Display extension

`extendDisplayType('LinearBasicDisplay', ...)` adds a track-menu entry that
opens the selector, and on confirm sets `groupBy` to
`{type:'attribute', attribute:'subtrack'}` and writes `hiddenGroupKeys`.

`groupByRadioMenuItem` already supports this shape: its `extra` option is
documented as "a dimension that activates through its own flow rather than a
direct select, such as a tag whose radio opens a dialog for the tag name".

## What stock v5 does not give us

Two user-visible defects, both in `FEATURE_GROUP_BY_DIMENSIONS.attribute`:

1. **Lane order.** `featureGroupSections` sorts by `compareGroupKeys`, which is
   code-point. Declaration order is ignored.
2. **Lane labels.** The attribute dimension builds its label as
   `` `${attribute}: ${groupKey}` ``, so a lane renders as
   `"subtrack: Intron junctions"`.

Neither blocks shipping. Both are fixed by one small upstream change, deferred
below.

## Explicitly out of scope: runtime ad-hoc lanes

A reader picking any feature attribute from a discovered list and splitting the
track on it, with no configuration. Rejected for now: VEuPathDB's lanes are
editorial (IntronJunctions, InterPro domains, MS peptides, synteny), declared in
track config with labels and facet metadata. Nobody types an attribute name at
runtime on our path.

Taking this on would also make the upstream discovery work a **prerequisite**
rather than a contribution, putting delivery back behind GMOD's review — the
thing the adapter approach was chosen to avoid.

## Deferred

- **Upstream PR: bring the `attribute` group-by dimension up to parity with the
  `partitionField` it is the sibling of.** Three gaps, all of which this work
  hit, and all of which the multi-row display has already solved:

  | | `partitionField` (multi-row) | `attribute` (groupBy) |
  | --- | --- | --- |
  | Attribute discovery | `partitionCandidates`, from `collectPartitionCandidates` | none — `GroupByDialog` is a free-text `TextField` |
  | Explicit order | `rowOrder` slot | none — `featureGroupSections` sorts code-point |
  | Section label | the raw partition value | `` `${attribute}: ${value}` `` |

  Mostly a matter of extracting what already exists into a shared module:
  `collectPartitionCandidates` (`MultiRowGetFeaturesRPC/packMultiRowFeatures.ts`)
  and the cross-region union in
  `LinearMultiRowFeatureDisplay/partitionFields.ts`. Estimated 60-80 LOC plus
  tests. Sent after the plugin works, so we are never blocked on review and the
  PR arrives with a working consumer behind it.

  Note the discovery list is sampled from **loaded** features, so it depends on
  what is in view; multi-row handles this by unioning across regions, since two
  regions may be served by adapters that saw different optional columns.
- **Per-lane coordinate transforms (synteny).** One lane per organism, syntenic
  spans re-fitted to the reference's visible region. v5 has
  `MultiWaySyntenyDisplay` — "a per-window, anchor-star, one-affine-frame-per-genome
  lane stack" — which already does the transform work. Its documented ceiling is
  the blocker: "a lane cannot show a second track, and the gene track it shows is
  not the track the user configured a display for". Separate conversation.
- **Per-lane fixed heights.** v4 had `perSubtrackHeight`/`minSubtrackHeight`;
  `groupBy` sizes sections to content. PR #1 records the fixed floor as a bug
  that was removed, so content-sizing is believed to be what was wanted. Revisit
  only if VEuPathDB disagrees.

## Testing

`resolveSubtracks` and the facet model keep their existing tests. New unit tests
cover the adapter's filter matching: all-criteria-must-match, range
half-openness, first-match-wins, no-match becomes the catch-all.

**A green jsdom test is not evidence a component renders.** `@mui/material` is
on core's ReExports list, so the plugin gets the host's copy at runtime while
jest renders against the plugin's own devDependency. On `init-dev` this exact
gap passed a full suite while shipping checkboxes with no accessible name,
because `inputProps` was removed in MUI 9. Every selector change is verified by
building the UMD and inspecting the DOM in a real jbrowse-web.

## Salvage ledger

| From `init-dev` | Fate |
| --- | --- |
| `resolveSubtracks.ts` + test | Verbatim |
| `SubtrackSelector/` (1,469 LOC, 3 tests) | Port, MUI 7->9 check |
| `docs/subtrack-selector.md` | Keep as selector spec |
| `SubtrackFeatureRenderer/` (7,168 LOC) | Delete — forked canvas |
| `subtrackGeometry.test.ts` | Delete — pinned block-convergence invariants |
| peptide/CDS chain, `g2p_mapper` | Delete — dormant per PR #1 |
| `docs/upstream-canvas-extensibility.md` | Rewrite as the deferred upstream ask |
| build scaffolding (rollup, jest, tsconfig) | Port, needs v5 dependency rework |

Roughly 9,225 LOC to roughly 900.
