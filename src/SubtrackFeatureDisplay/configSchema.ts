import { ConfigurationSchema } from '@jbrowse/core/configuration'

import type PluginManager from '@jbrowse/core/PluginManager'

/**
 * #config SubtrackFeatureDisplay
 * Configuration schema for SubtrackFeatureDisplay
 * Extends the base linear display config with subtrack-specific options
 */
export function configSchemaFactory(pluginManager: PluginManager) {
  // Get baseLinearDisplayConfigSchema from plugin manager
  const { baseLinearDisplayConfigSchema } = pluginManager.lib[
    'Plugin-linear-genome-view'
  ] as any

  return ConfigurationSchema(
    'SubtrackFeatureDisplay',
    {},
    {
      /**
       * #baseConfiguration
       */
      baseConfiguration: baseLinearDisplayConfigSchema,
      /**
       * #identifier
       */
      explicitIdentifier: 'displayId',
    },
  )
}
