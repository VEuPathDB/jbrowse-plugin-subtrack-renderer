import { DisplayType } from '@jbrowse/core/pluggableElementTypes'

import { configSchemaFactory } from './configSchema'
import { stateModelFactory } from './model'

import type PluginManager from '@jbrowse/core/PluginManager'

/**
 * Create SubtrackFeatureDisplay display type
 */
export default function SubtrackFeatureDisplayF(pluginManager: PluginManager) {
  const LinearFeatureDisplayType = pluginManager.getDisplayType(
    'LinearFeatureDisplay',
  )

  return new DisplayType({
    name: 'SubtrackFeatureDisplay',
    displayName: 'Subtrack feature display',
    configSchema: configSchemaFactory(pluginManager),
    stateModel: stateModelFactory(pluginManager),
    trackType: 'FeatureTrack',
    viewType: 'LinearGenomeView',
    ReactComponent: LinearFeatureDisplayType?.ReactComponent,
  })
}
