# facet: upstream gaps

**Status:** two of three closed upstream; one open and deferred. Two
unsanctioned extension points, both broken between 5.0.0-beta.10 and beta.18.
**Audience:** whoever next touches lane rendering in this plugin

Renamed from `groupby-upstream-gaps.md`. JBrowse renamed the feature from
`groupBy` to `facet` and, in the same stretch of work, closed two of the three
gaps this document was written to record.

## Context

This plugin once forked ~7,168 lines of JBrowse's canvas renderer
(`CanvasFeatureRenderer`) to draw stacked, independently laid out lanes. That
fork is gone twice over.

First, JBrowse 5 deleted the block-based rendering system it depended on and,
independently, shipped in-track stacked labelled sections — the same feature by
a different name. The plugin replaced its renderer with an adapter that stamped
a `subtrack` attribute onto each feature so stock JBrowse could section on it.

Then `facet.field` learned to read an attribute name directly, and the adapter
became dead weight too. Our pipeline writes `subtrack` into the GFF and JBrowse
sections on it with no plugin code in the path. ~9,225 LOC to ~900.

This document exists so nobody re-derives the one remaining defect, or
rediscovers the two that are already fixed and tries to fix them again.

## Closed upstream

### Lane order — closed by `facet.sort`

Sections were sorted code-point by group key, so declared lane order was
ignored. `facet.sort` is now exactly the declared order: the values it lists
stack first, in that order, and the rest follow sorted
(`groupKeyComparator`, `packages/core/src/util/groupKeys.ts`).

Earlier betas spelled the slot `domain`; beta.18 stopped accepting that
spelling (upstream `34d312d`), so a config still writing
`domain` loads with a `SectionFacet does not declare domain` warning and stacks
its lanes sorted.

Note what `sort` deliberately is *not*: it is no part of `groupKeySpaceOf`,
which is the facet's `field` alone. So reordering lanes does not invalidate
anything keyed by group key — in particular it does not reset what a reader hid
from a section chip. This plugin depends on that, and
`src/displayExtension/index.ts` writes `sort` on every selection change
because of it.

### Attribute discovery — closed by `field: 'featureField'`

The old dialog was a bare free-text `TextField`: you had to already know the
attribute name. `facet.field` is now a `featureField` slot, which accepts an
attribute name, a dotted path into a structured field (`INFO.SVTYPE`,
`tags.HP`), a `jexl:` expression, or `strand`.

This plugin never hit the gap — it always passes a fixed, known attribute — but
it was recorded here and is recorded as closed for symmetry.

## Open: section chips are named by the data

`categoricalField.sectionLabel` falls back to `` `${field}: ${key}` ``
(`packages/core/src/util/categoricalField.ts`). A lane whose data value is
`gene` renders as `subtrack: gene`, never as `Genes`, no matter what the catalog
calls it. A catalog entry's `displayName` reaches the picker and has nowhere to
go on the chip.

**The machinery to fix it already exists and is one slot short of reachable.**
`categoricalField` takes a `labels` array — "names the `domain`'s values in a
key, one each in order" — and `sectionLabel` prefers it over the fallback. But
`facetConfigSchema` (`packages/display-kit/src/facetConfigSchema.ts`) declares
only `field` and `sort`, and the canvas display's `facetField()`
(`plugins/canvas/src/LinearBasicDisplay/facet.ts`) passes only `{domain: sort}`.

So the upstream change is: add a `labels` stringArray slot to
`facetConfigSchema` alongside `sort`, and thread it through `facetField()`.
Exactly parallel to `sort`, against machinery that already supports it. It is
a `jbrowse-components` change, not a plugin change, and a small clean PR rather
than a fork.

**Deferred by decision (2026-10-07):** `subtrack: gene` is acceptable for
VEuPathDB's purposes. Revisit if the chips need to read editorially.

## Open: the catalog is descriptive, not a whitelist

Not an upstream gap — a design question this plugin has not answered.

The plugin hides catalog lanes the reader's selection leaves out.
It says nothing about a group key that is *not* in the catalog, so a `subtrack`
value present in the data but undeclared draws in a section of its own and the
picker will not offer it. Features with no `subtrack` value at all land in
JBrowse's `''` catch-all, which likewise always shows.

This surfaced in the demo config, whose facet field is a jexl ternary mapping
every type but gene/mRNA/contig to `''` — so Volvox's 203 other features stack
in a second, undeclared lane. With a real `subtrack` attribute written for every
feature the case does not arise, but "every feature" is a pipeline guarantee,
not a plugin one.

Three options, unchosen:

1. **Describe only** (today). An undeclared value is a lane without a label.
2. **Whitelist.** Hide every key not in the catalog, `''` included. An
   undeclared value becomes invisible — which also makes a pipeline bug silent.
3. **Restrict but list.** Hide undeclared keys, but surface them in the picker
   as strays the reader can opt into.

## Open: hiding is post-fetch

A hidden lane's features are still fetched, parsed and laid out; only the layout
drops them. Hiding costs a relayout and no RPC, which is the right trade at ten
lanes and possibly the wrong one at several hundred.

The alternative is the display's `jexlFilters`, which cuts the fetch itself —
trading a cheap toggle for a refetch whenever a lane is added. **Not measured.**
Measure before choosing; the current behaviour was picked for toggle latency and
that reasoning still holds unless the numbers say otherwise.

## Open: a display cannot hide a lane on its own behalf

Through beta.17 `HiddenGroupsMixin` had a `displayHiddenGroupKeys` hook, and
`hiddenGroupKeys` folded it with the reader's chip hides. That hook is how the
plugin hid the catalog's default-off lanes. beta.18 removed it (upstream
`29c9844`, "lost its one override and goes with it": ours was invisible to
them), and hidden sections became config only, `facet.hidden`. Nothing errored:
every one of a synteny track's 126 lanes simply showed.

The plugin now overrides `hiddenGroupKeys` itself, folding its own set into
`hiddenGroups` (`facet.hidden`). The canvas display reads `hiddenGroupKeys`, so
the behaviour is beta.10's exactly, and `displayExtension.test.ts` pins the fold
against the real mixin. **This is an override of a getter upstream no longer
treats as an extension point** — the same liability as the overlay below.

The sanctioned shape would be to write the selection into `facet.hidden`
(catalog minus selection), the way upstream's own self-alignment lane went. That
merges the reader's chip hides and the curated selection into one set, so
"Show all" would show every catalog lane — a change to what a selection means,
so it was not taken as part of a version bump.

## Open: a display cannot add an overlay layer

The ortholog shading draws over the display's canvas, and there is no supported
way for a plugin to put it there.

`extendDisplayType` reaches the state model and nothing else — it resolves to
`display.extendStateModel(...)`. The display's layers (`GroupLabelsLayer`,
`FloatingLabelsLayer`, `OverlayScrollLayer`) are composed inside
`FeatureComponent.tsx`, which a plugin does not own.

What this plugin does instead: `extendDisplayType` is a thin wrapper over
`pluginManager.addToExtensionPoint('Core-extendPluggableElement', ...)`, that
callback is handed the element and takes back what it returns, and
`DisplayType.ReactComponent` is a plain mutable field. So the component is
wrapped there, rendering the display followed by the overlay.

**This is unsanctioned and should be treated as a liability, not a pattern.**
`ReactComponent` is writable today by omission rather than by promise. A JBrowse
that makes it readonly, or that restructures how `FeatureComponent` composes its
layers, breaks this — and the plugin's own tests will not notice, because they
exercise the geometry rather than the attachment.

It reads the display's laid-out boxes as well, which is the same exposure from
the model side: beta.12 removed `featureItemMap` (upstream `805c509`) in favour
of `featureIdIndex`, and the layer threw `Cannot read properties of undefined
(reading 'values')` on every render — taking the track down with it, since the
error lands in the display's own error boundary. Jest stayed green; only a
browser showed it.

The blast radius is one plugin and the fix would be a plugin change, which is
why it was taken on rather than asking upstream first. The ask, if it is ever
made, is small and has an obvious shape: upstream already renders a stack of
overlay layers and already publishes the two primitives a plugin would need for
one (`@jbrowse/render-core/OverlayCanvas` and `ScrollLockedOverlay` are both on
core's ReExports list). What is missing is only an extension point naming the
layer stack.

### The related trap, recorded because it cost a browser round trip

A canvas overlay's `draw` closure runs from an effect, which is **outside mobx's
tracking**. Reading the view inside it observes nothing: the component never
re-renders, the closure keeps its identity, and `OverlayCanvas` never re-runs
it. The overlay paints correctly once and then holds still while the track moves
under it, which reads as a missing feature rather than a bug.

Read every reactive value in the render body and let `draw` paint what is
already computed. `OverlayCanvas`'s own docstring says as much — "wrap the
caller in `observer` ... `draw`'s identity then changes exactly when those
inputs do" — and `observer` alone does nothing if the inputs are not read where
it can see them.
