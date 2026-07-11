import Plugin from '@jbrowse/core/Plugin'
import PluginManager from '@jbrowse/core/PluginManager'
import SubtrackFeatureRendererF from './SubtrackFeatureRenderer'
import SubtrackFeatureDisplayF from './SubtrackFeatureDisplay'

export default class SubtrackRendererPlugin extends Plugin {
  name = 'SubtrackRendererPlugin'

  install(pluginManager: PluginManager) {
    // Both must be registered during install(); the registry is frozen once
    // createPluggableElements() runs. The callbacks are lazy, so LinearFeatureDisplay
    // is already available by the time they are actually invoked.
    pluginManager.addRendererType(() => SubtrackFeatureRendererF(pluginManager))
    pluginManager.addDisplayType(() => SubtrackFeatureDisplayF(pluginManager))
  }
}
