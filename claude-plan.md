# Implementation Plan: Subtrack Feature for JBrowse2

## Overview

Create a new JBrowse2 plugin that provides subtrack functionality, allowing features to be grouped and displayed in vertically stacked lanes within a single track display. Features will be filtered and grouped by GFF attributes (e.g., dataset_name, domain_type, organism) with support for complex filtering criteria including score ranges.

**Plugin Name**: `@jbrowse/plugin-subtrack-renderer` (or similar)

**Approach**: Create a new renderer plugin based on CanvasFeatureRenderer code, with modifications to support subtrack filtering and vertical stacking.

## User Requirements

- **Visual Layout**: Subtracks stacked vertically within one track display
- **Configuration**: Predefined subtracks via config with explicit filter criteria, user can toggle visibility
- **Rendering**: All subtracks share same rendering configuration (height, color, etc.)
- **Feature Filtering**: Features are filtered based on visible subtracks - hidden subtracks = features not rendered
- **Scale**: Must handle 50+ subtracks efficiently (synteny track use case)
- **Metadata Support**: Subtracks have metadata for future faceted selection (Kingdom, Phylum, Class, Order, Species)
- **Use Cases**:
  1. BLAT alignments separated by dataset_name tag
  2. Intron junctions grouped by score ranges + annotation match status
  3. InterPro domains separated by domain type
  4. Syntenic markers separated by organism (50+ subtracks with taxonomic metadata)

## Architecture Design

### Plugin Architecture

**New Plugin Structure**:
```
plugins/subtrack-renderer/
├── src/
│   ├── index.ts                        # Plugin registration
│   ├── SubtrackFeatureRenderer/
│   │   ├── index.ts                    # Renderer registration
│   │   ├── configSchema.ts             # Configuration schema
│   │   ├── SubtrackFeatureRenderer.ts  # Main renderer (based on CanvasFeatureRenderer)
│   │   ├── layoutFeatures.ts           # Modified to filter and group features
│   │   ├── doAll.ts                    # Modified rendering pipeline
│   │   ├── makeImageData.ts            # Canvas rendering with subtrack labels
│   │   ├── subtrackUtils.ts            # Filtering and positioning utilities
│   │   └── ... (other files from CanvasFeatureRenderer)
│   └── SubtrackConfigDialog/           # UI for configuring subtracks (Phase 2)
└── package.json
```

### Core Strategy

Based on the JBrowse1 implementation pattern:
1. **Predefined subtracks** with explicit feature filters (not auto-discovery)
2. **Filter features BEFORE layout** - only features matching visible subtracks are rendered
3. **Independent layouts per subtrack** using MultiLayout with composite keys (`refName:subtrackLabel`)
4. **Visibility toggles** - some subtracks hidden by default
5. **Metadata support** - subtracks carry metadata for future faceted selection UI

This approach:
- Separate plugin - no core JBrowse2 modifications
- Works with any feature type (GFF, BAM, etc.)
- Users opt-in by using `type: "SubtrackFeatureRenderer"`
- Scales to 50+ subtracks
- Extensible to faceted UI later

### Key Implementation Points

1. **Configuration Schema**: Add `subtracks` configuration to CanvasFeatureRenderer
2. **Grouping Logic**: Extract group value from features based on attribute name + optional score ranges
3. **Layout Keys**: Use composite keys `${refName}:${groupValue}` for MultiLayout.getSublayout()
4. **Vertical Positioning**: Calculate Y offsets for each subtrack and apply when rendering
5. **Height Calculation**: Sum all visible subtrack heights instead of layout.getTotalHeight()

## Files to Create/Modify

### 0. Plugin Bootstrap
**File**: `plugins/subtrack-renderer/src/index.ts` (NEW)

Create the main plugin file:
```typescript
import Plugin from '@jbrowse/core/Plugin'
import PluginManager from '@jbrowse/core/PluginManager'
import SubtrackFeatureRendererType from './SubtrackFeatureRenderer'

export default class SubtrackRendererPlugin extends Plugin {
  name = 'SubtrackRendererPlugin'

  install(pluginManager: PluginManager) {
    pluginManager.addRendererType(() => new SubtrackFeatureRendererType(pluginManager))
  }
}
```

### 1. Configuration Schema
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/configSchema.ts` (NEW - copy from CanvasFeatureRenderer)

Copy CanvasFeatureRenderer configSchema and add new configuration sections:
```typescript
// Copy entire CanvasFeatureRenderer config schema, then add:

subtracks: {
  type: 'frozen',
  description: 'Array of subtrack definitions with filters and metadata',
  defaultValue: []
}

subtrackConfig: ConfigurationSchema('SubtrackConfiguration', {
  enabled: { type: 'boolean', defaultValue: false },
  perSubtrackHeight: { type: 'integer', defaultValue: 100 },
  spacing: { type: 'integer', defaultValue: 5 },
  showLabels: { type: 'boolean', defaultValue: true },
})
```

**Subtrack structure** (in the `subtracks` frozen array):
```typescript
interface Subtrack {
  label: string                    // Display name (e.g., "Human (Homo sapiens)")
  featureFilters: Record<string, any>  // Filter criteria: { organism: "hsap", ... }
  metadata?: Record<string, string>    // Optional metadata for faceted selection
  visible: boolean                 // Visibility toggle
}
```

Example configuration:
```json
{
  "subtrackConfig": {
    "enabled": true,
    "perSubtrackHeight": 80,
    "spacing": 5,
    "showLabels": true
  },
  "subtracks": [
    {
      "label": "Human",
      "featureFilters": { "organism": "hsap" },
      "metadata": { "kingdom": "Animalia", "species": "Homo sapiens" },
      "visible": true
    },
    {
      "label": "Mouse",
      "featureFilters": { "organism": "mmus" },
      "visible": false
    }
  ]
}
```

### 2. Feature Filtering and Subtrack Utilities
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/subtrackUtils.ts` (NEW)

Create utility functions:

```typescript
export interface Subtrack {
  label: string
  featureFilters: Record<string, any>
  metadata?: Record<string, string>
  visible: boolean
}

export interface SubtrackConfig {
  enabled: boolean
  perSubtrackHeight: number
  spacing: number
  showLabels: boolean
}

export interface SubtrackInfo {
  label: string
  yOffset: number
  height: number
  visible: boolean
}

/**
 * Test if a feature matches a subtrack's filter criteria
 * Returns true if ALL filter criteria match
 */
export function featureMatchesSubtrack(
  feature: Feature,
  subtrack: Subtrack
): boolean {
  for (const [key, value] of Object.entries(subtrack.featureFilters)) {
    const featureValue = feature.get(key)

    // Handle array values (OR logic within a filter)
    if (Array.isArray(value)) {
      if (!value.includes(featureValue)) return false
    }
    // Handle single value
    else if (featureValue !== value) {
      return false
    }
  }
  return true
}

/**
 * Find which subtrack a feature belongs to
 * Returns the first matching visible subtrack, or null
 */
export function getFeatureSubtrack(
  feature: Feature,
  subtracks: Subtrack[]
): Subtrack | null {
  for (const subtrack of subtracks) {
    if (!subtrack.visible) continue
    if (featureMatchesSubtrack(feature, subtrack)) {
      return subtrack
    }
  }
  return null
}

/**
 * Calculate vertical positioning for visible subtracks
 */
export function calculateSubtrackPositions(
  subtracks: Subtrack[],
  config: SubtrackConfig
): Map<string, SubtrackInfo> {
  const positions = new Map<string, SubtrackInfo>()
  let currentY = 0

  for (const subtrack of subtracks) {
    if (!subtrack.visible) continue

    positions.set(subtrack.label, {
      label: subtrack.label,
      yOffset: currentY,
      height: config.perSubtrackHeight,
      visible: true
    })

    currentY += config.perSubtrackHeight + config.spacing
  }

  return positions
}

/**
 * Build composite layout key for MultiLayout
 */
export function buildLayoutKey(refName: string, subtrackLabel: string): string {
  return `${refName}:${subtrackLabel}`
}
```

### 3. Layout Features with Filtering
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/layoutFeatures.ts` (NEW - copy and modify)

Copy layoutFeatures.ts from CanvasFeatureRenderer and modify to filter and group features:

**Changes**:
1. Add `subtracks` and `subtrackConfig` parameters
2. Calculate subtrack positions upfront
3. **Filter features** - only process features matching visible subtracks
4. Layout features with composite keys (`refName:subtrackLabel`)
5. Apply subtrack Y offset to topPx
6. Return layoutRecords AND subtrackPositions

**Key code pattern**:
```typescript
export function layoutFeatures({
  features,
  bpPerPx,
  region,
  configContext,
  layout,
  pluginManager,
  subtracks,           // NEW
  subtrackConfig,      // NEW
}: {
  // ... existing params
  subtracks: Subtrack[]
  subtrackConfig: SubtrackConfig
}): {
  layoutRecords: LayoutRecord[]
  subtrackPositions: Map<string, SubtrackInfo>
} {
  const layoutRecords: LayoutRecord[] = []

  // Calculate subtrack positions
  const subtrackPositions = calculateSubtrackPositions(subtracks, subtrackConfig)

  // Process each feature
  for (const feature of features.values()) {
    // CRITICAL: Filter - find which subtrack this feature belongs to
    const subtrack = getFeatureSubtrack(feature, subtracks)
    if (!subtrack) {
      // Feature doesn't match any visible subtrack - skip it
      continue
    }

    // Get subtrack position info
    const subtrackInfo = subtrackPositions.get(subtrack.label)
    if (!subtrackInfo) continue

    // Layout the feature
    const featureLayout = layoutFeature({ /* ... */ })

    // Build composite layout key
    const layoutKey = buildLayoutKey(region.refName, subtrack.label)

    // Add to appropriate sublayout
    const topPx = layout.addRect(
      layoutKey,  // Composite key for this refName:subtrack
      feature.id(),
      layoutStart,
      layoutEnd,
      totalLayoutHeight + yPadding,
      feature,
      { /* serializable data */ }
    )

    if (topPx !== null) {
      // Apply subtrack Y offset for vertical stacking
      const adjustedTopPx = topPx + subtrackInfo.yOffset

      layoutRecords.push({
        feature,
        layout: featureLayout,
        topPx: adjustedTopPx,
        subtrackLabel: subtrack.label,  // Track which subtrack
        // ... other fields
      })
    }
  }

  return { layoutRecords, subtrackPositions }
}
```

### 4. Main Rendering Pipeline
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/doAll.ts` (NEW - copy and modify)

Copy from CanvasFeatureRenderer and add:
1. Read subtrack config in doAll
2. Pass subtracks and subtrackConfig to layoutFeatures
3. Receive subtrackPositions from layoutFeatures
4. Calculate height as sum of subtrack heights (when enabled)
5. Pass subtrackPositions to makeImageData for label rendering

**Height calculation**:
```typescript
if (subtrackConfig.enabled && subtrackPositions.size > 0) {
  height = Array.from(subtrackPositions.values()).reduce(
    (sum, info) => sum + info.height + spacing,
    0
  ) - spacing  // Remove last spacing
} else {
  height = Math.max(1, layout.getTotalHeight())
}
```

### 5. Render Config Context
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/renderConfig.ts` (NEW - copy and modify)

Copy from CanvasFeatureRenderer and add:
- Add `subtracks` and `subtrackConfig` fields to RenderConfigContext
- Read and cache them in createRenderConfigContext()

### 6. Image Rendering
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/makeImageData.ts` (NEW - copy and modify)

Copy from CanvasFeatureRenderer and add:
- Add `subtrackPositions` parameter
- After drawing features, draw subtrack labels and divider lines
- Labels positioned at `yOffset + 5`
- Dividers at `yOffset + height`

### 7. Main Renderer Class
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/SubtrackFeatureRenderer.ts` (NEW - copy and modify)

Copy CanvasFeatureRenderer.ts and modify:
- Change class name to `SubtrackFeatureRenderer`
- Update to use modified doAll, layoutFeatures, etc.
- Include subtrackPositions in serialized result

### 8. Renderer Type Registration
**File**: `plugins/subtrack-renderer/src/SubtrackFeatureRenderer/index.ts` (NEW)

```typescript
import { ConfigurationSchema } from '@jbrowse/core/configuration'
import { createBaseTrackConfig } from '@jbrowse/core/pluggableElementTypes'
import PluginManager from '@jbrowse/core/PluginManager'
import SubtrackFeatureRendererReactComponent from './components/SubtrackFeatureRendererReactComponent'
import configSchema from './configSchema'

export default function SubtrackFeatureRendererF(pluginManager: PluginManager) {
  return new SubtrackFeatureRendererType({
    name: 'SubtrackFeatureRenderer',
    configSchema,
    ReactComponent: SubtrackFeatureRendererReactComponent,
    pluginManager,
  })
}
```

### 9. Additional Files to Copy
Copy these files from CanvasFeatureRenderer as-is (or with minor modifications):
- `layoutFeature.ts` - Glyph-based layout
- `glyphs/*.ts` - Glyph definitions
- `floatingLabels.ts` - Label handling
- `peptideUtils.ts` - Peptide data fetching
- `types.ts` - Type definitions
- `components/*.tsx` - React components

## Configuration Examples

### Example 1: BLAT Alignments by Dataset
```json
{
  "type": "FeatureTrack",
  "trackId": "blat_alignments",
  "adapter": {
    "type": "Gff3Adapter",
    "gffLocation": { "uri": "alignments.gff3.gz" }
  },
  "displays": [{
    "type": "LinearBasicDisplay",
    "renderer": {
      "type": "SubtrackFeatureRenderer",  // Use the new renderer
      "subtrackConfig": {
        "enabled": true,
        "perSubtrackHeight": 80,
        "spacing": 10,
        "showLabels": true
      },
      "subtracks": [
        {
          "label": "Dataset A",
          "featureFilters": { "dataset_name": "dataset_A" },
          "visible": true
        },
        {
          "label": "Dataset B",
          "featureFilters": { "dataset_name": "dataset_B" },
          "visible": true
        },
        {
          "label": "Dataset C",
          "featureFilters": { "dataset_name": "dataset_C" },
          "visible": false
        }
      ]
    }
  }]
}
```

### Example 2: Synteny Track (50+ Taxa with Metadata)
```json
{
  "type": "FeatureTrack",
  "trackId": "synteny",
  "adapter": {
    "type": "Gff3Adapter",
    "gffLocation": { "uri": "synteny.gff3.gz" }
  },
  "displays": [{
    "type": "LinearBasicDisplay",
    "renderer": {
      "type": "SubtrackFeatureRenderer",  // Use the new renderer
      "subtrackConfig": {
        "enabled": true,
        "perSubtrackHeight": 60,
        "spacing": 3,
        "showLabels": true
      },
      "subtracks": [
        {
          "label": "Human (Homo sapiens)",
          "featureFilters": { "organism": "hsap" },
          "metadata": {
            "kingdom": "Animalia",
            "phylum": "Chordata",
            "class": "Mammalia",
            "order": "Primates",
            "species": "Homo sapiens"
          },
          "visible": true
        },
        {
          "label": "Mouse (Mus musculus)",
          "featureFilters": { "organism": "mmus" },
          "metadata": {
            "kingdom": "Animalia",
            "phylum": "Chordata",
            "class": "Mammalia",
            "order": "Rodentia",
            "species": "Mus musculus"
          },
          "visible": false
        }
        // ... 50+ more species
      ]
    }
  }]
}
```

### Example 3: Intron Junctions (Multiple Filter Criteria)
```json
{
  "subtrackConfig": {
    "enabled": true,
    "perSubtrackHeight": 60,
    "spacing": 5
  },
  "subtracks": [
    {
      "label": "High Score Annotated",
      "featureFilters": {
        "annotation_match": "annotated",
        "score": { "min": 50, "max": 100 }
      },
      "visible": true
    },
    {
      "label": "High Score Novel",
      "featureFilters": {
        "annotation_match": "novel",
        "score": { "min": 50, "max": 100 }
      },
      "visible": true
    },
    {
      "label": "Medium Score Annotated",
      "featureFilters": {
        "annotation_match": "annotated",
        "score": { "min": 10, "max": 50 }
      },
      "visible": false
    }
  ]
}
```

## Implementation Sequence

### Phase 1: Plugin Bootstrap
1. Create plugin directory structure: `plugins/subtrack-renderer/`
2. Create `package.json` with dependencies
3. Create plugin registration in `src/index.ts`
4. Set up build configuration

### Phase 2: Copy Base Files
5. Copy CanvasFeatureRenderer files to new plugin as starting point:
   - configSchema.ts
   - SubtrackFeatureRenderer.ts (rename from CanvasFeatureRenderer.ts)
   - layoutFeatures.ts
   - doAll.ts
   - makeImageData.ts
   - renderConfig.ts
   - layoutFeature.ts
   - glyphs/
   - components/
   - types.ts
   - Other utility files

### Phase 3: Add Subtrack Functionality
6. Add subtrack configuration schema to configSchema.ts
7. Create subtrackUtils.ts with filtering and positioning functions
8. Modify layoutFeatures.ts to filter and group features
9. Modify doAll.ts to calculate height from subtracks
10. Modify makeImageData.ts to draw subtrack labels/dividers
11. Update renderConfig.ts to include subtrack config
12. Update renderer registration in index.ts

### Phase 4: Testing
13. Build the plugin
14. Configure JBrowse2 to load the plugin
15. Test with simple subtrack configuration
16. Test with 50+ subtracks (synteny use case)
17. Test visibility toggling
18. Verify layout caching works correctly

## Edge Cases to Handle

### Challenge 1: Layout Caching Invalidation
**Problem**: LayoutSession caches layouts based on config. Toggling subtrack visibility needs to invalidate cache.

**Solution**: Include subtracks in the cache validation check:

```typescript
// In LayoutSession.cachedLayoutIsValid()
deepEqual(this.props.subtracks, cachedLayout.props.subtracks)
```

### Challenge 2: Features Matching Multiple Subtracks
**Problem**: A feature might match multiple subtrack filters.

**Solution**: Use first-match strategy - feature goes into first matching visible subtrack (order matters in config).

### Challenge 3: Features Matching No Subtracks
**Problem**: Feature doesn't match any visible subtrack filter.

**Solution**: Skip the feature entirely - it won't be rendered. This is intentional behavior.

### Challenge 4: Performance with 50+ Subtracks
**Problem**: Synteny track can have 50+ subtracks.

**Solution**:
- Only render visible subtracks (features in hidden subtracks are filtered out)
- Efficient filter matching with early exit
- MultiLayout already handles many sublayouts efficiently

### Challenge 5: Score Range Filters
**Problem**: Need to support range filters like `score: { min: 10, max: 50 }`.

**Solution**: Extend `featureMatchesSubtrack()` to handle range objects:
```typescript
if (typeof value === 'object' && 'min' in value && 'max' in value) {
  if (featureValue < value.min || featureValue >= value.max) return false
}
```

### Challenge 6: Subtrack Order and Layout Keys
**Problem**: Need consistent subtrack ordering for Y offsets.

**Solution**: Process subtracks in config array order - this determines vertical stacking order.

## Plugin Installation and Usage

### Installing the Plugin

1. **Build the plugin**:
```bash
cd plugins/subtrack-renderer
yarn build
```

2. **Configure JBrowse2 to load the plugin** (in config.json):
```json
{
  "plugins": [
    {
      "name": "SubtrackRenderer",
      "url": "http://localhost:3000/path/to/subtrack-renderer/dist/index.js"
    }
  ]
}
```

3. **Use in track configuration**:
```json
{
  "renderer": {
    "type": "SubtrackFeatureRenderer",
    // ... subtrack config
  }
}
```

## Testing Strategy

1. Create test GFF with multiple dataset_name values
2. Configure track to use `SubtrackFeatureRenderer`
3. Configure subtracks with featureFilters
4. Verify features separated into vertical lanes
5. Toggle subtrack visibility, verify track height adjusts
6. Test score range filtering with junction features
7. Test with 50+ subtracks (synteny use case)
8. Test with features not matching any subtrack filter

## UI Implementation Plan

### Phase 1: Simple Track Configuration Dialog (Initial)
Add a "Configure Subtracks" option to track menu that opens a dialog:
- Checkbox list of subtracks
- Search/filter box (simple text match on label)
- Show/hide all buttons
- Save updates subtrack visibility in track config

**Files to create**:
- Dialog component with checkbox list (React component)
- Track menu integration (add menu item)
- Config update logic (modify display config on save)

**Advantages**:
- Simpler to implement
- Consistent with JBrowse2 patterns
- Good for moderate numbers of subtracks

### Phase 2: Faceted Widget (Future Enhancement for Synteny)
For tracks with 50+ subtracks and rich metadata:
- Standalone widget similar to hierarchical track selector
- Faceted filtering by metadata fields (Kingdom, Phylum, Class, Order, Species)
- Text search across labels and metadata
- Facet counts showing number of subtracks per category
- Integration with track config for persistence

**Reference**: Similar to JBrowse1 `FacetedSubtracks.js` but using JBrowse2 React patterns and MST state management

## Future Enhancements

1. **Faceted subtrack selector widget** (Phase 2 UI)
2. **Drag-and-drop subtrack reordering** in configuration dialog
3. **Per-subtrack rendering config** (different colors/heights per subtrack)
4. **Subtrack collapsing** (minimize to label bar only)
5. **Subtrack groups/categories** (hierarchical grouping of related subtracks)
6. **Import/export subtrack selections** (save favorite subtrack combinations)
