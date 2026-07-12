import type PluginManager from '@jbrowse/core/PluginManager'
import type { AnyReactComponentType } from '@jbrowse/core/util'

/**
 * The linear-genome-view plugin is not on core's ReExports list, so a
 * runtime-loaded plugin cannot `import` from it -- bundling it would create a
 * duplicate copy of the plugin. The supported route is the `exports` block that
 * LinearGenomeViewPlugin publishes on its Plugin instance.
 *
 * Note LinearFeatureDisplay is deliberately NOT a registered DisplayType in
 * core, so `pluginManager.getDisplayType('LinearFeatureDisplay')` always fails;
 * BaseLinearDisplay/BaseLinearDisplayComponent here are the intended bases.
 */
interface LgvExports {
  BaseLinearDisplayComponent: AnyReactComponentType
  BaseLinearDisplay: any
  baseLinearDisplayConfigSchema: any
}

export function getLgvExports(pluginManager: PluginManager): LgvExports {
  const plugin = pluginManager.getPlugin('LinearGenomeViewPlugin')
  if (!plugin) {
    throw new Error(
      'LinearGenomeViewPlugin not found; SubtrackFeatureDisplay builds on its exports',
    )
  }
  return (plugin as unknown as { exports: LgvExports }).exports
}
