import PluginManager from '@jbrowse/core/PluginManager'
import GranularRectLayout from '@jbrowse/core/util/layouts/GranularRectLayout'
import { MultiLayout } from '@jbrowse/core/util/layouts'
import SimpleFeature from '@jbrowse/core/util/simpleFeature'
import { createCanvas, Image } from 'canvas'

import configSchema from './configSchema'
import { doAll } from './doAll'
import { layoutFeatures } from './layoutFeatures'
import { createRenderConfigContext } from './renderConfig'

const pluginManager = new PluginManager([])
pluginManager.configure()

// @ts-expect-error node-canvas shims for renderToAbstractCanvas
global.nodeImage = Image
// @ts-expect-error
global.nodeCreateCanvas = createCanvas

const SUBTRACKS = [
  { label: 'Genes', featureFilters: { type: 'gene' }, visible: true },
  { label: 'Matches', featureFilters: { type: 'match' }, visible: true },
]

function makeConfig(overrides: Record<string, unknown> = {}) {
  const { subtrackConfig, ...rest } = overrides
  return configSchema.create(
    {
      ...rest,
      subtracks: SUBTRACKS,
      subtrackConfig: {
        enabled: true,
        spacing: 8,
        showLabels: true,
        minSubtrackHeight: 20,
        ...(subtrackConfig as object),
      },
    },
    { pluginManager },
  )
}

function region(start: number, end: number) {
  return {
    refName: 'ctgA',
    start,
    end,
    assemblyName: 'volvox',
    reversed: false,
  }
}

function feat(id: string, type: string, start: number, end: number) {
  return new SimpleFeature({
    uniqueId: id,
    refName: 'ctgA',
    type,
    start,
    end,
    name: id,
  })
}

function featureMap(...fs: SimpleFeature[]) {
  return new Map(fs.map(f => [f.id(), f]))
}

// a fresh MultiLayout, as SubtrackLayoutSession builds
function makeLayout() {
  return new MultiLayout(GranularRectLayout, { pitchX: 1, pitchY: 1 })
}

async function render({
  layout,
  features,
  config,
  reg,
  laneHeights,
}: {
  layout: ReturnType<typeof makeLayout>
  features: Map<string, SimpleFeature>
  config: ReturnType<typeof makeConfig>
  reg: ReturnType<typeof region>
  laneHeights?: Record<string, number>
}) {
  return doAll({
    pluginManager,
    layout: layout as any,
    features: features as any,
    renderProps: {
      config,
      regions: [reg],
      bpPerPx: 1,
      highResolutionScaling: 1,
      subtrackLaneHeights: laneHeights,
    } as any,
  })
}

describe('subtrack lane geometry', () => {
  describe('per-block content heights', () => {
    test('a block reports heights for each visible lane', async () => {
      const res = await render({
        layout: makeLayout(),
        features: featureMap(feat('g1', 'gene', 100, 200)),
        config: makeConfig(),
        reg: region(0, 1000),
      })

      expect(Object.keys(res.subtrackContentHeights).sort()).toEqual([
        'Genes',
        'Matches',
      ])
      // a lane holding a feature needs height; an empty lane needs none
      expect(res.subtrackContentHeights.Genes).toBeGreaterThan(0)
      expect(res.subtrackContentHeights.Matches).toBe(0)
    })

    // THE REGRESSION TEST FOR THE PAN BUG.
    //
    // Blocks share one accumulating MultiLayout, and GranularRectLayout keeps
    // getTotalHeight() as a monotonic high-water mark that discardRange() never
    // lowers. Deriving a block's reported height from the sublayout total
    // therefore made it grow when panning into dense sequence and never shrink
    // on the way back. A block must report only what ITS OWN features need.
    test('a sparse block does not inherit a dense block\'s height', async () => {
      const layout = makeLayout()
      const config = makeConfig()

      // dense block: several overlapping genes, so the lane stacks up
      const dense = await render({
        layout,
        config,
        reg: region(0, 1000),
        features: featureMap(
          feat('g1', 'gene', 100, 900),
          feat('g2', 'gene', 120, 920),
          feat('g3', 'gene', 140, 940),
          feat('g4', 'gene', 160, 960),
        ),
      })

      // sparse block, laid into the SAME layout, which is now tall
      const sparse = await render({
        layout,
        config,
        reg: region(1000, 2000),
        features: featureMap(feat('g5', 'gene', 1100, 1200)),
      })

      expect(dense.subtrackContentHeights.Genes).toBeGreaterThan(
        sparse.subtrackContentHeights.Genes!,
      )
    })

    test('reported height does not depend on the geometry handed in', async () => {
      const features = featureMap(feat('g1', 'gene', 100, 200))
      const config = makeConfig()

      const withoutGeometry = await render({
        layout: makeLayout(),
        features,
        config,
        reg: region(0, 1000),
      })
      const withHugeGeometry = await render({
        layout: makeLayout(),
        features,
        config,
        reg: region(0, 1000),
        laneHeights: { Genes: 500, Matches: 500 },
      })

      // this is the property that makes the display's two-pass convergence
      // terminate: geometry in must never influence height out
      expect(withHugeGeometry.subtrackContentHeights).toEqual(
        withoutGeometry.subtrackContentHeights,
      )
    })
  })

  describe('lane geometry supplied by the display', () => {
    test('renderProps.subtrackLaneHeights is authoritative', async () => {
      const res = await render({
        layout: makeLayout(),
        features: featureMap(feat('g1', 'gene', 100, 200)),
        config: makeConfig(),
        reg: region(0, 1000),
        laneHeights: { Genes: 120, Matches: 60 },
      })

      // total = 120 + 60 + one 8px gap between the two lanes
      expect(res.height).toBe(188)
    })

    test('lanes are stacked in order with spacing between them', async () => {
      const res = await render({
        layout: makeLayout(),
        features: featureMap(feat('g1', 'gene', 100, 200)),
        config: makeConfig(),
        reg: region(0, 1000),
        laneHeights: { Genes: 100, Matches: 40 },
      })
      // height = 100 + 8 + 40; the Matches lane must start below Genes + gap
      expect(res.height).toBe(148)
    })
  })

  describe('lane sizing', () => {
    test('minSubtrackHeight is the floor for a near-empty lane', async () => {
      const res = await render({
        layout: makeLayout(),
        features: featureMap(feat('g1', 'gene', 100, 200)),
        config: makeConfig(),
        reg: region(0, 1000),
        laneHeights: { Genes: 5, Matches: 0 },
      })
      // both lanes clamp up to minSubtrackHeight (20), + 8 spacing
      expect(res.height).toBe(48)
    })

    // perSubtrackHeight used to be applied as Math.max(content, perSubtrackHeight),
    // i.e. a floor, which padded every lane out to 100px and produced the large
    // vertical gaps between subtracks. It is only a fallback now.
    test('perSubtrackHeight is a fallback, not a floor', async () => {
      const res = await render({
        layout: makeLayout(),
        features: featureMap(feat('g1', 'gene', 100, 200)),
        config: makeConfig({ subtrackConfig: { perSubtrackHeight: 500 } }),
        reg: region(0, 1000),
        // display has published geometry, so perSubtrackHeight must not apply
        laneHeights: { Genes: 30, Matches: 20 },
      })
      expect(res.height).toBe(58) // 30 + 8 + 20, NOT padded out to 500s
    })
  })

  describe('feature partitioning', () => {
    test('features are routed to the lane their filter matches', async () => {
      const { layoutRecords } = layoutFeatures({
        features: featureMap(
          feat('g1', 'gene', 100, 200),
          feat('m1', 'match', 300, 400),
        ) as any,
        bpPerPx: 1,
        region: region(0, 1000),
        configContext: createRenderConfigContext(makeConfig()),
        layout: makeLayout() as any,
        pluginManager,
        subtracks: SUBTRACKS,
        subtrackConfig: {
          enabled: true,
          perSubtrackHeight: 100,
          minSubtrackHeight: 20,
          spacing: 8,
          showLabels: true,
        },
      })

      const byId = Object.fromEntries(
        layoutRecords.map(r => [r.feature.id(), r.subtrackLabel]),
      )
      expect(byId.g1).toBe('Genes')
      expect(byId.m1).toBe('Matches')
    })

    test('a feature matching no lane is dropped', async () => {
      const { layoutRecords } = layoutFeatures({
        features: featureMap(feat('x1', 'exon', 100, 200)) as any,
        bpPerPx: 1,
        region: region(0, 1000),
        configContext: createRenderConfigContext(makeConfig()),
        layout: makeLayout() as any,
        pluginManager,
        subtracks: SUBTRACKS,
        subtrackConfig: {
          enabled: true,
          perSubtrackHeight: 100,
          minSubtrackHeight: 20,
          spacing: 8,
          showLabels: true,
        },
      })
      expect(layoutRecords).toHaveLength(0)
    })
  })

  // Regression: with subtracks off, layoutKey used to be feature.id(), which
  // gave every feature its own private sublayout of the MultiLayout. Nothing
  // collided with anything, so every feature landed at y=0 stacked on top of
  // each other. subtrackConfig.enabled defaults to false, so this was the
  // renderer's DEFAULT behaviour.
  describe('subtracks disabled', () => {
    test('features share one sublayout and stack', () => {
      const layout = makeLayout()
      const { layoutRecords } = layoutFeatures({
        features: featureMap(
          feat('a', 'gene', 100, 500),
          feat('b', 'gene', 200, 600),
        ) as any,
        bpPerPx: 1,
        region: region(0, 1000),
        configContext: createRenderConfigContext(
          configSchema.create({}, { pluginManager }),
        ),
        layout: layout as any,
        pluginManager,
      })

      expect(layoutRecords).toHaveLength(2)
      // overlapping features must not be drawn on top of one another
      expect(layoutRecords[0]!.topPx).not.toBe(layoutRecords[1]!.topPx)
      // and they must live in ONE sublayout, keyed by refName
      expect([...(layout as any).subLayouts.keys()]).toEqual(['ctgA'])
    })
  })
})
