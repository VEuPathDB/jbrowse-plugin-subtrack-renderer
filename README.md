# jbrowse-plugin-subtrack-renderer

A JBrowse 2 plugin that adds subtrack rendering capabilities, allowing features to be divided into vertically stacked subtracks within a single track display.

## Features

- Predefined subtracks with explicit feature filters
- Vertical stacking of features by subtrack
- Feature filtering before layout (hidden subtracks = features not rendered)
- Support for range filters, array filters, and single value filters
- Configurable subtrack heights, spacing, and labels
- Metadata support for future faceted selection

## Installation

### Prerequisites

- Node.js (v14 or later)
- Yarn package manager
- JBrowse 2 installation

### Setup

```bash
# Install dependencies
yarn install

# Run initial setup (creates .jbrowse directory and configuration)
yarn setup
```

## Development

### Starting the Development Environment

```bash
# Start the plugin dev server (watches for changes and rebuilds)
yarn start

# In another terminal, start JBrowse with the plugin loaded
yarn browse
```

The plugin will be served at `http://localhost:9002` and JBrowse will run at `http://localhost:8999`.

### Building

```bash
# Build the plugin for production
yarn build
```

## Testing

### Unit Tests

```bash
# Run Jest tests
yarn test
```

### End-to-End Tests

```bash
# Run Cypress e2e tests
yarn test:e2e

# Open Cypress test runner
yarn cypress:open
```

## Configuration

### Using the Plugin in JBrowse 2

Add the plugin to your JBrowse configuration:

```json
{
  "plugins": [
    {
      "name": "SubtrackRenderer",
      "url": "http://localhost:9002/dist/jbrowse-plugin-subtrack-renderer.umd.development.js"
    }
  ]
}
```

### Track Configuration

Configure a track to use the SubtrackFeatureRenderer:

```json
{
  "type": "FeatureTrack",
  "trackId": "my_track",
  "name": "My Subtrack Track",
  "assemblyNames": ["hg38"],
  "adapter": {
    "type": "Gff3TabixAdapter",
    "gffGzLocation": {
      "uri": "https://example.com/data.gff.gz",
      "locationType": "UriLocation"
    },
    "index": {
      "location": {
        "uri": "https://example.com/data.gff.gz.tbi",
        "locationType": "UriLocation"
      }
    }
  },
  "displays": [
    {
      "type": "LinearBasicDisplay",
      "displayId": "my_track-LinearBasicDisplay",
      "renderer": {
        "type": "SubtrackFeatureRenderer",
        "subtrackConfig": {
          "enabled": true,
          "perSubtrackHeight": 60,
          "spacing": 8,
          "showLabels": true
        },
        "subtracks": [
          {
            "label": "Genes",
            "featureFilters": {
              "type": "gene"
            },
            "visible": true
          },
          {
            "label": "Regions",
            "featureFilters": {
              "type": "region"
            },
            "visible": true
          }
        ]
      }
    }
  ]
}
```

### Configuration Options

#### Subtrack Config

- `enabled` (boolean): Enable/disable subtrack rendering
- `perSubtrackHeight` (number): Height of each subtrack in pixels
- `spacing` (number): Vertical spacing between subtracks in pixels
- `showLabels` (boolean): Show/hide subtrack labels

#### Subtrack Definition

- `label` (string): Display name for the subtrack
- `featureFilters` (object): Filter criteria for features
  - Single value: `{ "attribute": "value" }`
  - Array values: `{ "attribute": ["value1", "value2"] }`
  - Range values: `{ "attribute": { "min": 0, "max": 100 } }`
- `visible` (boolean): Show/hide the subtrack

## Code Quality

```bash
# Run ESLint
yarn lint

# Auto-fix linting issues
yarn lint --fix
```

## License

See [LICENSE](LICENSE) file for details.

## Contributing

This plugin follows the JBrowse 2 plugin development guidelines. For more information on developing JBrowse 2 plugins, see the [JBrowse 2 documentation](https://jbrowse.org/jb2/docs/).
