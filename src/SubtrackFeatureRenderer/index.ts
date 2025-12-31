import SubtrackFeatureRenderer from './SubtrackFeatureRenderer'
import CanvasFeatureRendering from './CanvasFeatureRendering'
import configSchema from './configSchema'

import type PluginManager from '@jbrowse/core/PluginManager'

export default function SubtrackFeatureRendererF(pluginManager: PluginManager) {
  return new SubtrackFeatureRenderer({
    name: 'SubtrackFeatureRenderer',
    ReactComponent: CanvasFeatureRendering,
    configSchema,
    pluginManager,
  }) as any
}

export { default as configSchema } from './configSchema'
