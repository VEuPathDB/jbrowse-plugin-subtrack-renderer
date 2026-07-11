// jsdom does not expose a few globals that @jbrowse/core reaches for. Node has
// them all; hand them over.
const { TextEncoder, TextDecoder } = require('util')

globalThis.TextEncoder ??= TextEncoder
globalThis.TextDecoder ??= TextDecoder

// readConfObject snapshots config values with structuredClone
globalThis.structuredClone ??= v => v && JSON.parse(JSON.stringify(v))
