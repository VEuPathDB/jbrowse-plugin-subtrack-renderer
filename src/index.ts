import Plugin from '@jbrowse/core/Plugin'

import installDisplayExtension from './displayExtension'
import installSyntenyRescaleAdapter from './syntenyRescale'
import installSyntenyRefetch from './syntenyRescale/installSyntenyRefetch'
import installSyntenyRibbons from './syntenyRibbons/installSyntenyRibbons'

import type PluginManager from '@jbrowse/core/PluginManager'

export default class SubtrackRendererPlugin extends Plugin {
  name = 'SubtrackRenderer'

  // Registration happens here, never in configure(): the pluggable-element
  // registry is frozen once createPluggableElements() has run.
  install(pluginManager: PluginManager) {
    installDisplayExtension(pluginManager)
    installSyntenyRescaleAdapter(pluginManager)
    installSyntenyRefetch(pluginManager)
    installSyntenyRibbons(pluginManager)
  }
}
