import Plugin from '@jbrowse/core/Plugin'
import PluginManager from '@jbrowse/core/PluginManager'
import SubtrackFeatureRendererF from './SubtrackFeatureRenderer'

export default class SubtrackRendererPlugin extends Plugin {
  name = 'SubtrackRendererPlugin'

  install(pluginManager: PluginManager) {
    pluginManager.addRendererType(() => SubtrackFeatureRendererF(pluginManager))
  }
}
