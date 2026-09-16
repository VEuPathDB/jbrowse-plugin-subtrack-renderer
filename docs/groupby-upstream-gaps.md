# groupBy: known upstream gaps

**Status:** known gaps, accepted — not planned work
**Audience:** whoever next touches lane rendering in this plugin

## Context

This plugin used to fork ~7,168 lines of JBrowse's canvas renderer
(`CanvasFeatureRenderer`) to draw stacked, independently laid out lanes. That
fork is gone. JBrowse 5 deleted the block-based rendering system it depended on
and, independently, shipped `LinearBasicDisplay.groupBy` — in-track stacked
labelled sections with glyphs, per-section row packing, and section show/hide —
which is the same feature by a different name. The plugin now wraps a data
adapter that stamps a `subtrack` attribute onto each feature and configures
stock `groupBy: {type: 'attribute', attribute: 'subtrack'}`. Zero changes to
`jbrowse-components` are required.

This document exists so nobody re-derives the two cosmetic defects that come
with consuming `groupBy` as shipped, or the reason they were left alone.

## The two accepted defects

### 1. Lane order

`featureGroupSections` sorts sections with `compareGroupKeys`, which is
code-point order on the group key (here, the lane label). A declared lane
order — the order lanes appear in the adapter's `lanes` config, which is also
filter precedence — is not honored for display order. The sibling multi-row
display has a `rowOrder` slot for exactly this; `groupBy`'s `attribute`
dimension has no equivalent.

### 2. Lane labels

The `attribute` dimension builds each section's label as
`` `${attribute}: ${value}` ``. With `attribute: 'subtrack'`, a lane configured
with `label: 'Genes'` renders as `subtrack: Genes` rather than `Genes`.

## A related, not-yet-hit gap: attribute discovery

Recorded for context, not because this plugin needs it: the `attribute`
dimension has no attribute discovery. `GroupByDialog` is a bare free-text
`TextField` — the user (or, on our path, the plugin) must already know the
attribute name. The multi-row display again has the shape this would take:
`partitionCandidates`, built by `collectPartitionCandidates`, which samples the
first 20 loaded features and reads `Object.keys(feature.toJSON())` minus a
deny-list. This plugin never hits the gap because it always passes a fixed,
known attribute (`subtrack`); it's recorded here because the other two gaps
were found via the same partitionField/groupBy comparison and a future reader
comparing the two dimensions will find it too.

## Why these are not being fixed

Closing these was considered and declined. `groupBy` is stock JBrowse 5 and
this plugin consumes it exactly as shipped, with no local patch and no fork.
Each defect is cosmetic — a display-order and a label-string detail — not a
missing capability.

**The one condition that would force a revisit:** if VEuPathDB decides lane
order must be editorial (declared, not alphabetical) rather than accepting
code-point ordering. That is the lane-order gap specifically; the label-string
gap has no comparable forcing function and would likely be fixed at the same
time if the order gap ever is.

If it is ever picked up, the fix is small and lives upstream, not here: extract
`collectPartitionCandidates` (in `MultiRowGetFeaturesRPC/packMultiRowFeatures.ts`)
and the cross-region union in `LinearMultiRowFeatureDisplay/partitionFields.ts`
into a shared module the `attribute` dimension can also use, and give
`featureGroupSections` an optional declared-order comparator alongside
`compareGroupKeys`. That is a `jbrowse-components` change, not a plugin change.
