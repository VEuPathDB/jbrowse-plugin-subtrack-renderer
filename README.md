# jbrowse-plugin-subtrack-renderer

A JBrowse 5 plugin that lets a reader choose which **subtracks** of a feature
track are shown, and in what order, from a faceted picker.

The lanes themselves are stock JBrowse. `LinearBasicDisplay.facet` splits a
track into stacked, labelled, independently packed sections, one per value of a
feature field, and its `sort` sets the order they stack in. Our data carries a
`subtrack` attribute and JBrowse sections on it directly — no plugin code is in
the rendering path at all.

What this plugin adds is the one thing JBrowse has no notion of: a **declared
catalog** of lanes with per-lane metadata. A JBrowse section is `{key, label}`
derived from whatever the data happened to contain; it has no display name, no
organism, no study, nothing to filter a few hundred of them by. The catalog
supplies that, and the picker facets on it.

This plugin makes no changes to `jbrowse-components` and forks no core code.

## Configuration

Two halves, and they are deliberately in different places.

**The catalog** lives on the track's generic `metadata` slot, because it
describes the data:

```json
{
  "type": "FeatureTrack",
  "trackId": "subtrack_demo",
  "assemblyNames": ["volvox"],
  "metadata": {
    "subtracks": [
      {
        "label": "gene",
        "displayName": "Genes",
        "metadata": { "organism": "Volvox carteri", "study": "Reference" },
        "visible": true
      },
      {
        "label": "mRNA",
        "displayName": "mRNAs",
        "metadata": { "organism": "Volvox carteri", "study": "Reference" }
      }
    ]
  },
  "adapter": { "type": "Gff3TabixAdapter", "uri": "..." },
  "displays": [...]
}
```

**The facet** lives on the display, because it describes the rendering, and is
entirely stock JBrowse:

```json
{
  "type": "LinearBasicDisplay",
  "displayId": "subtrack_demo-LinearBasicDisplay",
  "facet": { "field": "subtrack", "sort": ["gene", "mRNA"] }
}
```

A working copy wired into a full session is at
`test_config/subtrack-test.json`. For a plugin-free control — stock `facet` with
no catalog and no picker — see `test_config/facet-demo.json`.

### Lane definitions

Each entry in `metadata.subtracks` is `{label, displayName?, metadata?,
visible?}`:

- **`label`** — the lane's identity, and the value the data's `subtrack`
  attribute carries. It is the group key JBrowse sections on and the row id in
  the picker. A label matching no drawn section is simply a lane with no
  features in view.
- **`displayName`** — what the picker shows in place of `label`. The section
  chip still reads the data value; see Known gaps.
- **`metadata`** — arbitrary key/value pairs. Nothing in rendering reads it; it
  is what the picker's facets are built from. Only primitive values become
  facets.
- **`visible`** — whether the lane is on before the reader has chosen anything.
  Defaults to **true**, so a catalog that declares hundreds of lanes and wants to
  open on a handful must mark the rest `false`, or set `visible: true` on the
  handful and `false` on the others explicitly.

Lane membership is **not** this plugin's business. A feature belongs to the lane
named by its own `subtrack` attribute, which the data pipeline writes into the
GFF. This is the single largest simplification over the JBrowse 4 version, which
carried a filter language, an adapter to evaluate it, and a feature-decoration
layer to stamp the result.

### Initial visibility and the catch-all

The display opens on the lanes the catalog marks `visible`, not on every lane.
The reader's own selection, once made, wins over the catalog defaults.

**A value in the data that the catalog does not declare still draws**, in a
section of its own, and the picker will not offer it. Features with no
`subtrack` value at all land in JBrowse's `''` catch-all section, which likewise
always shows. If your pipeline emits a `subtrack` for every feature and declares
every value, neither case arises; if it does not, expect an extra lane. Whether
the catalog should instead act as a whitelist is an open question — see Known
gaps.

## Lane selection UI

A track-menu entry, **Select subtracks...**, opens the faceted picker: search by
name, drill into facets built from each lane's `metadata`, and order the
selection. It appears only on tracks that declare a catalog *and* whose display
facets on something; every other track is untouched.

On those tracks the stock **Group by...** entry is removed. It rewrites the
facet field wholesale, which would repoint the sections at a different key space
and strand every label in the catalog.

Confirming a selection writes both halves at once: the membership to the
plugin's own `subtrackSelection` property, which the hidden-lane derivation
reads, and the order to the stock `facet.sort`. `sort` is deliberately no
part of JBrowse's `groupKeySpace`, so reordering lanes does not reset what a
reader hid from a section chip, which JBrowse keeps in `facet.hidden`.

See [`docs/subtrack-selector.md`](docs/subtrack-selector.md) for the picker's
design.

## Synteny track

A synteny track is a subtrack track whose features are genes from other genomes
lifted onto the reference: one lane per organism (`<org>`) holding its genes and
one (`<org> span`) holding its syntenic regions, sectioned on `subtrack` like any
other. Two things are added on top, both switched on by the adapter type alone.

### Rescale: `SyntenyRescaleAdapter`

The GFF stores each syntenic gene's liftover onto the reference, which is exact
per gene and lossy between them: paralogs stack on one reference gene and
insertions in the other genome compress to nothing. `SyntenyRescaleAdapter`
wraps the adapter that reads the GFF and repositions genes against the window
being drawn, from their positions on their own genome, span by span. It reruns
when the view moves more than a quarter screen.

What you see: within a span, genes are spaced as they are on their own genome
and fill the span's reference extent. In a reversed span the genes still read
left to right in reference order while their native coordinates count down, so
the first gene on the reference is the last on its own sequence. A rescaled
feature's details panel shows `rescaledFrom`, its stored liftover position.
Span bars (`syntenic_region`) are not moved; they mark the extent the rescale is
computed over.

| slot | default | |
|---|---|---|
| `subadapter` | — | the adapter holding the synteny GFF, e.g. `Gff3TabixAdapter` |
| `nativeStartAttribute` | `nativeStart` | gene start on its own genome |
| `nativeEndAttribute` | `nativeEnd` | gene end on its own genome |
| `spanAttribute` | `syntenyId` | groups genes that rescale together |
| `reversedAttribute` | `spanIsReversed` | `1` when the span runs antiparallel |
| `orthologGroupAttribute` | `orthologGroup` | folded into the feature id for shading |
| `rescaleTypes` | `["gene"]` | feature types repositioned |

Attribute names match case-insensitively, since GFF3 attributes reach a feature
lowercased. A gene with no native coordinates, or alone in its span within the
window, keeps its stored position.

### Ortholog shading

Grey ribbons join genes that share an `orthologGroup` across lanes, drawn over
the stacked sections so a gene can be followed from the reference down through
every shown organism. It is on by default on a synteny track and toggled by the
track menu's **Shade orthologs**. Shading draws only while the view shows a
single sequence; across several the entry reads **Shade orthologs (one sequence
at a time)** and is disabled. Hidden lanes are skipped, and a ribbon joins the
nearest shown lanes that hold the group.

### Example

```json
{
  "type": "FeatureTrack",
  "trackId": "pfal3D7_synteny",
  "name": "Synteny with pfal3D7",
  "assemblyNames": ["pfal3D7"],
  "metadata": {
    "subtracks": [
      { "label": "pfal3D7", "displayName": "Plasmodium falciparum 3D7" },
      { "label": "pfal3D7 span", "displayName": "Plasmodium falciparum 3D7 (spans)" },
      { "label": "pyoeyoelii17XNL", "displayName": "Plasmodium yoelii yoelii 17XNL" },
      { "label": "pyoeyoelii17XNL span", "displayName": "Plasmodium yoelii yoelii 17XNL (spans)" },
      { "label": "pberANKA", "displayName": "Plasmodium berghei ANKA", "visible": false },
      { "label": "pberANKA span", "displayName": "Plasmodium berghei ANKA (spans)", "visible": false }
    ]
  },
  "adapter": {
    "type": "SyntenyRescaleAdapter",
    "subadapter": {
      "type": "Gff3TabixAdapter",
      "gffGzLocation": { "uri": "pfal3D7.synteny.gff3.gz" },
      "index": { "location": { "uri": "pfal3D7.synteny.gff3.gz.tbi" } }
    }
  },
  "displays": [
    {
      "type": "LinearBasicDisplay",
      "displayId": "pfal3D7_synteny-LinearBasicDisplay",
      "facet": {
        "field": "subtrack",
        "sort": ["pfal3D7", "pfal3D7 span", "pyoeyoelii17XNL", "pyoeyoelii17XNL span", "pberANKA", "pberANKA span"]
      }
    }
  ]
}
```

A gene line in the GFF carries, beside `subtrack`, the adapter's attributes:

```
Pf3D7_01_v3  VEuPathDB_synteny  gene  29511  37127  .  +  .  ID=syngene_11529799;subtrack=pfalNF54;syntenyId=344066;nativeStart=30515;nativeEnd=38130;spanIsReversed=0;orthologGroup=OG8_0007825
```

## Known gaps

**Section chips are named by the data, not by the catalog.** A lane's chip reads
`` `${field}: ${value}` `` — with a `subtrack` attribute, `subtrack: gene`
rather than `Genes`. `displayName` reaches the picker and cannot reach the chip.
JBrowse's `categoricalField` already accepts a `labels` array and prefers it
over that fallback, but `facetConfigSchema` has no `labels` slot to carry one.
This is a one-slot upstream ask, exactly parallel to `sort`. Deferred.

**Two extension points the plugin uses are unsanctioned.** The default-off
lanes are hidden by overriding `HiddenGroupsMixin.hiddenGroupKeys`, because the
`displayHiddenGroupKeys` hook this used to go through was removed upstream in
5.0.0-beta.18. Ortholog shading is composed into `LinearBasicDisplay`'s React
component and reads its `featureIdIndex`, `groupSections` and `scrollTop`. A
JBrowse that renames any of these breaks the plugin, and only a browser shows
it: the tests stand in for the display. See
[`docs/facet-upstream-gaps.md`](docs/facet-upstream-gaps.md).

**Hiding is post-fetch.** A hidden lane's features are still fetched, parsed and
laid out; only the layout drops them. At a few hundred lanes this may be worth
trading for the display's `jexlFilters`, which would cut the fetch at the cost of
a refetch whenever a lane is added. Not measured.

**The catalog is descriptive, not a whitelist.** See above.

[`docs/facet-upstream-gaps.md`](docs/facet-upstream-gaps.md) has the detail and
the history, including the two gaps upstream has since closed.

## Development

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22

pnpm install
pnpm build       # rollup -> dist/*.umd.development.js
pnpm test        # jest
pnpm typecheck   # tsc --noEmit
```

To try it against a running JBrowse, serve the built bundle and point a config
at it:

```bash
npx serve --cors --listen 9002 .
```

```json
"plugins": [
  {
    "name": "SubtrackRenderer",
    "url": "http://localhost:9002/dist/jbrowse-plugin-subtrack-renderer.umd.development.js"
  }
]
```

`pnpm lint` exists but is **not** a pass/fail gate here — it is red at baseline.
Lint only the directory you touched, e.g. `npx eslint src/<dir>`.

### Two things that will burn you

**A green jsdom test is not evidence that a component renders.**
`@mui/material` is on core's ReExports list, so at runtime the plugin gets the
*host's* copy while jest renders against the plugin's own devDependency. On the
JBrowse 4 branch this gap passed a full suite while shipping checkboxes with no
accessible name at all, because `inputProps` was removed in MUI 9. Verify every
selector change by building the UMD and inspecting the DOM in a real
jbrowse-web.

**Verify API claims against the published package, not a local checkout of
`jbrowse-components` main.** Main runs well ahead of the last release, and this
plugin compiles against what npm publishes. More than one afternoon has gone to
a signature that existed only on main.
