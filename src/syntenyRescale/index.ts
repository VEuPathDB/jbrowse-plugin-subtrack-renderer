import { AdapterType } from '@jbrowse/core/pluggableElementTypes'

import configSchema from './configSchema'

import type PluginManager from '@jbrowse/core/PluginManager'

export default function installSyntenyRescaleAdapter(
  pluginManager: PluginManager,
) {
  pluginManager.addAdapterType(
    () =>
      new AdapterType({
        name: 'SyntenyRescaleAdapter',
        configSchema,
        getAdapterClass: () =>
          import('./SyntenyRescaleAdapter').then(m => m.default),
        adapterMetadata: {
          category: 'Synteny',
          description:
            'repositions syntenic features against the window being drawn, so paralogs separate and insertions stay visible',
        },
      }),
  )
}
