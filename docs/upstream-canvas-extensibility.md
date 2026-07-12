# Making CanvasFeatureRenderer extensible

**Status:** proposal, not yet raised with GMOD
**Audience:** jbrowse-components maintainers; whoever picks this up on our side
**Related:** [GMOD/jbrowse-components#5597](https://github.com/GMOD/jbrowse-components/pull/5597) (unrelated fix, but the channel is open)

## The ask in one line

Give `plugins/canvas` the same extension seams `plugins/linear-genome-view`
already has, so that a downstream plugin can add a feature to the canvas renderer
by subclassing it instead of forking 4,000 lines of it.

## Why this exists

`jbrowse-plugin-subtrack-renderer` adds one capability to JBrowse: a feature
track whose features are partitioned into stacked, independently laid out lanes
("subtracks"), each with its own label — a port of JBrowse 1's `CanvasSubtracks`.

The subtrack behaviour itself is about **870 lines**. The plugin is about
**5,000**. The other ~4,100 lines are a verbatim fork of
`plugins/canvas/src/CanvasFeatureRenderer`, carried solely because there is no
way to reuse it:

| | lines | notes |
| --- | ---: | --- |
| genuinely subtrack-specific | 869 | renderer, lane geometry, display model |
| forked glyphs | 1,207 | unmodified upstream logic |
| forked peptide/CDS rendering | ~480 | **dormant** — gated on `colorByCDS`, which we never set |
| forked labels, chevrons, filters, layout, config | ~1,450 | mostly unmodified |
| forked pipeline (`doAll`, `makeImageData`, ...) | ~1,000 | modified, but around a small core of changes |

That fork is not a stylistic complaint. It rots, silently, and we have paid for
it. Every one of these was a copied upstream type that drifted:

- `theme.palette.framesCDS` stopped type-checking (core's MUI palette
  augmentation was not being loaded)
- two hand-copied `GlyphType` interfaces, one declaring `draw?` optional when
  core requires it
- a hand-copied display-model interface still declaring `selectFeatureById` with
  two parameters after core had given it a third
- a layout typed `BaseLayout` when it is really a `MultiLayout` — different
  `addRect` arity, so every call was "wrong" by one argument
- `configSchema2.ts`, a back-compat shim for a `SvgFeatureRenderer` that no
  longer exists, complete with a stray `function x() {}`

None were runtime bugs. All were the compiler being lied to by a stale copy, and
they masked each other well enough to cost a full day.

## Why forking was the only option

We checked all three routes a runtime-loaded plugin could take. All are closed:

1. **Deep import the internals.** `@jbrowse/plugin-canvas`'s npm `exports` map
   publishes only `"."`:

   ```json
   { ".": { "types": "./esm/index.d.ts", "import": "./esm/index.js" } }
   ```

   So `doAll`, `makeImageData`, `drawFeature`, `layoutFeatures`, and the glyphs
   are unreachable.

2. **Go through the plugin's `exports` block at runtime.** `CanvasPlugin` has
   none. `LinearGenomeViewPlugin` does, and it is exactly how we obtain
   `BaseLinearDisplay`, `BaseLinearDisplayComponent` and
   `baseLinearDisplayConfigSchema`:

   ```ts
   // plugins/linear-genome-view/src/index.ts
   export default class LinearGenomeViewPlugin extends Plugin {
     exports = {
       BaseLinearDisplayComponent,
       BaseLinearDisplay,
       baseLinearDisplayConfigSchema,
       SearchBox,
       ZoomControls,
       LinearGenomeView,
     }
   ```

   ```ts
   // us, consuming it
   const { BaseLinearDisplay } =
     pluginManager.getPlugin('LinearGenomeViewPlugin').exports
   ```

   Note a plain `import` will not do: `@jbrowse/plugin-*` is not on core's
   `ReExports` list, so a *value* import bundles a private duplicate of the whole
   plugin, with its own MST type identity, distinct from the copy the host
   registered. (`import type` is fine — it is erased at build time.)

3. **Subclass the registered renderer.** `CanvasFeatureRenderer` is only 39
   lines; the pipeline it drives is entirely module-level functions:

   ```ts
   export default class CanvasFeatureRenderer extends BoxRendererType {
     supportsSVG = true
     async render(renderProps: RenderArgsDeserialized) {
       const features = await this.getFeatures(renderProps)
       const layout = this.createLayoutInWorker(renderProps)
       const res = await doAll({ pluginManager, renderProps, layout, features })
       ...
     }
   }
   ```

   Even with the class in hand, `doAll` is a module import, not a method. There
   is nothing to override short of reimplementing the pipeline — which is what
   forking *is*.

## What we need

Four things. (1) is the big one; the rest are small and would each have saved us
a distinct bug.

### 1. An `exports` block on `CanvasPlugin`

Mirroring `LinearGenomeViewPlugin`. Minimum useful set:

```ts
export default class CanvasPlugin extends Plugin {
  name = 'CanvasPlugin'
  exports = {
    CanvasFeatureRenderer,      // the class, to subclass
    canvasFeatureRendererConfigSchema,
    doAll,                      // the pipeline
    layoutFeatures,
    makeImageData,
    drawFeature,
    builtinGlyphs,
    createRenderConfigContext,
  }
}
```

With just this, the subtrack plugin becomes a subclass plus its lane logic, and
~4,100 lines of forked code go away. Everything below is refinement.

### 2. A feature→layout-key seam in `doAll`

Core lays every feature into one layout:

```ts
layout.addRect(feature.id(), left, right, height, feature)
```

Subtracks need each feature routed to a **per-lane sublayout** of a
`MultiLayout`. That is a one-argument difference:

```ts
doAll({
  ...,
  // optional; defaults to today's behaviour when absent
  getLayoutKey?: (feature: Feature) => string,
})
```

`BoxRendererType.createLayoutInWorker()` is already overridable, so we can supply
the `MultiLayout` itself — we just cannot tell `doAll` how to key into it.

### 3. A vertical-offset seam at draw time

Lanes are drawn at a y-offset that is a property of the *lane*, not the feature.
Today `makeImageData` draws each record at its own `topPx`. A hook such as

```ts
makeImageData({ ..., getYOffset?: (record: LayoutRecord) => number })
```

would remove the need to fork it.

### 4. A sanctioned renderer→display channel for per-block metadata

This one is **not subtrack-specific** and is the most generally useful.

Any renderer whose geometry must be *consistent across blocks* (shared scales,
shared maxima, our lane heights) needs two things: the display must push the
agreed geometry down, and each block must report what it needs back up.

Downward already works: anything a display puts in `renderProps()` reaches the
renderer, and because core's `renderBlockData()` reads `renderProps()` inside a
mobx reaction, changing it re-renders **every block at once**. That is the
correct primitive and it is already there.

Upward does not. Core preserves only

```ts
{ reactElement, features, layout, maxHeightReached, renderProps, renderArgs }
```

from a render result; any other top-level field is dropped. And
`PrecomputedLayout`'s constructor copies only
`{ rectangles, totalHeight, maxHeightReached }`, so smuggling data inside
`layout` requires overriding `deserializeLayoutInClient()` to reattach it —
which is what we ended up doing:

```ts
deserializeLayoutInClient(json: SerializedLayout) {
  const layout = super.deserializeLayoutInClient(json)
  ;(layout as any).subtrackContentHeights = (json as any).subtrackContentHeights
  return layout
}
```

That works, but it is a workaround. A first-class passthrough — e.g. a
`rendererMetadata` field preserved onto the block model — would let any renderer
coordinate across blocks without abusing the layout payload.

## What we are not asking for

- No change to the default behaviour of `CanvasFeatureRenderer`. Every seam above
  is optional, with today's behaviour as the default.
- Not asking for subtracks to be upstreamed. It is VEuPathDB-specific; we are
  happy to maintain it. We just want to maintain **870 lines, not 5,000**.

## Fallback if upstream declines

Rank-ordered, all still worth doing:

1. **Trim the fork.** Delete the peptide/CDS chain (~480 lines, dormant — we
   never set `colorByCDS`) and any glyphs our tracks do not use (up to 1,207
   lines). Less code, less rot.
2. **Pin the fork's provenance.** Record the upstream commit each forked file was
   taken from, so re-syncing is a mechanical diff instead of archaeology. This is
   cheap and should be done regardless of what upstream says.
3. **Re-sync deliberately** on each JBrowse major, rather than discovering the
   drift through bugs.

## Appendix: seams that already exist and work

Recording these so no one re-derives them.

| need | mechanism |
| --- | --- |
| shared singleton of core, react, mobx, MST, MUI | on core's `ReExports` list → externals, not bundled |
| another plugin's **values** | `pluginManager.getPlugin('X').exports` |
| another plugin's **types** | plain `import type` — erased at build, costs nothing |
| custom layout object | override `BoxRendererType.createLayoutInWorker()` |
| re-render the entire visible region | mutate observable state read by `display.renderProps()` |
| per-block layout persistence | `BoxRendererType.createLayoutSession()` |

And one trap worth writing down: `GranularRectLayout.getTotalHeight()` is a
monotonic high-water mark (`pTotalHeight = max(pTotalHeight, top + height)`), and
`discardRange()` does not lower it. Anything derived from it can grow but never
shrink.
