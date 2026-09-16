import AdapterType from '@jbrowse/core/pluggableElementTypes/AdapterType'

import configSchema from './configSchema'

import type PluginManager from '@jbrowse/core/PluginManager'

export default function SubtrackAdapterF(pluginManager: PluginManager) {
  pluginManager.addAdapterType(
    () =>
      new AdapterType({
        name: 'SubtrackAdapter',
        displayName: 'Subtrack adapter',
        configSchema,
        getAdapterClass: () => import('./SubtrackAdapter').then(r => r.default),
      }),
  )
}
