import Plugin from '@jbrowse/core/Plugin'
import PluginManager from '@jbrowse/core/PluginManager'
import SubtrackFeatureRendererF from './SubtrackFeatureRenderer'
import SubtrackFeatureDisplayF from './SubtrackFeatureDisplay'

export default class SubtrackRendererPlugin extends Plugin {
  name = 'SubtrackRendererPlugin'

  install(pluginManager: PluginManager) {
    pluginManager.addRendererType(() => SubtrackFeatureRendererF(pluginManager))
  }

  configure(pluginManager: PluginManager) {
    // Register display type in configure phase to ensure LinearFeatureDisplay is available
    pluginManager.addDisplayType(() => SubtrackFeatureDisplayF(pluginManager))
  }
}
