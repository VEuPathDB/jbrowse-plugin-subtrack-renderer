# jbrowse-plugin-subtrack-renderer

A JBrowse 2 plugin that splits a feature track into stacked, labelled lanes
("subtracks") by feature attribute — for example, one lane per gene type, one
lane per organism, or one lane per study. It contributes a `SubtrackAdapter`
that wraps any other data adapter and stamps each feature with a lane label,
plus a faceted lane-picker dialog. All actual layout and drawing is done by
stock JBrowse's `LinearBasicDisplay.groupBy`; this plugin makes no changes to
`jbrowse-components` and forks no core rendering code.

## Version requirement — read this before anything else

This plugin depends on `LinearBasicDisplay.groupBy`, which landed upstream on
**2026-09-13**. The newest published JBrowse release as of this writing is
**`5.0.0-beta.8`** (2026-09-10) — **no published JBrowse contains the feature
this plugin depends on.**

We build against published beta.8 anyway, because the split is clean: the
adapter never imports `groupBy` — it only stamps a `subtrack` attribute onto
each feature and leaves the host to group on it. Everything this plugin
compiles against (`Plugin`, `ConfigurationSchema`, `AdapterType`,
`BaseFeatureDataAdapter`, `extendDisplayType`, the `LinearBasicDisplay` state
model) exists in beta.8. Only *running* the plugin end-to-end — actually
seeing lanes grouped and hidden — requires a JBrowse build newer than any
published release, built from `jbrowse-components` main.

If you pick this up: **do not assume a published JBrowse can run this
plugin's headline feature.** Check whether a beta with `groupBy` has shipped
yet before filing a bug that turns out to just be version drift.

## Configuration

A track adapter of type `SubtrackAdapter` wraps a sub-adapter and a list of
lanes. The display is stock `LinearBasicDisplay` with `groupBy` pointed at the
attribute the adapter stamps:

```json
{
  "type": "FeatureTrack",
  "trackId": "subtrack_demo",
  "assemblyNames": ["volvox"],
  "adapter": {
    "type": "SubtrackAdapter",
    "lanes": [
      {
        "label": "Genes",
        "featureFilters": { "type": "gene" },
        "metadata": { "organism": "Volvox carteri", "study": "Reference" }
      },
      {
        "label": "mRNAs",
        "featureFilters": { "type": "mRNA" },
        "metadata": { "organism": "Volvox carteri", "study": "Reference" }
      }
    ],
    "subadapter": {
      "type": "Gff3TabixAdapter",
      "gffGzLocation": {
        "uri": "http://localhost:3000/test_data/volvox/volvox.sort.gff3.gz",
        "locationType": "UriLocation"
      },
      "index": {
        "location": {
          "uri": "http://localhost:3000/test_data/volvox/volvox.sort.gff3.gz.tbi",
          "locationType": "UriLocation"
        }
      }
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

A working copy of this, wired into a full session, is at
`test_config/subtrack-test.json`.

### Lane definitions

Each entry in `lanes` is `{label, featureFilters, metadata?}`:

- **`label`** — the lane's identity. It is the value stamped onto matching
  features, the group key `LinearBasicDisplay` sections on, and the row id in
  the lane-picker dialog.
- **`featureFilters`** — a map of attribute name to expected value. All
  entries must match for a feature to belong to the lane (`AND`, not `OR`).
  Values are compared as strings (`String(feature.get(key)) === String(want)`).
  An entry may instead be `{min, max}`, which is a half-open numeric range
  (`min <= value < max`).
- **`metadata`** — optional, arbitrary key/value pairs. Nothing in rendering
  reads it; it is what the lane-picker dialog facets on.

Lanes are matched in array order and the **first match wins** — lane order in
the config is filter precedence. A feature matching no lane is left
unstamped, which puts it in the display's `''` catch-all section. See
[`docs/groupby-upstream-gaps.md`](docs/groupby-upstream-gaps.md) for what this
means for display order (spoiler: not the same as filter precedence — see
below).

### Known cosmetic defects

Two display-side quirks come from consuming `groupBy` as shipped, not from
this plugin:

- **Lane order.** Sections are sorted code-point by their group key, so the
  order lanes are declared in (their filter precedence) is not the order they
  are drawn in.
- **Lane labels.** A lane's section header reads `subtrack: <label>` rather
  than just `<label>`.

Neither is planned to be fixed here. Details, and the one thing that would
change that, are in
[`docs/groupby-upstream-gaps.md`](docs/groupby-upstream-gaps.md).

## Lane selection UI

The plugin adds a track-menu entry that opens a faceted lane picker: search by
name, drill into facets built from each lane's `metadata`, and reorder the
selected lanes. See [`docs/subtrack-selector.md`](docs/subtrack-selector.md)
for its design.

## Development

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22

pnpm install
pnpm build       # rollup -> dist/*.umd.development.js
pnpm test        # jest
pnpm typecheck   # tsc --noEmit
```

To try it against a running JBrowse, serve the built bundle and point a
config at it:

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

`pnpm lint` exists but is **not** a pass/fail gate here — it is red at
baseline. Lint only the directory you touched, e.g. `npx eslint src/<dir>`.

Remember the version caveat above: to actually see grouped lanes render, you
need a `jbrowse-web` build newer than any published release (built from
`jbrowse-components` main), not just a `pnpm install` of this plugin's
declared peer dependency.
