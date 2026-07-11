import { ConfigurationSchema } from '@jbrowse/core/configuration'

import { getLgvExports } from '../lgvExports'

import type PluginManager from '@jbrowse/core/PluginManager'

/**
 * #config SubtrackFeatureDisplay
 * Configuration schema for SubtrackFeatureDisplay
 * Extends the base linear display config with subtrack-specific options
 */
export function configSchemaFactory(pluginManager: PluginManager) {
  const { baseLinearDisplayConfigSchema } = getLgvExports(pluginManager)

  return ConfigurationSchema(
    'SubtrackFeatureDisplay',
    {
      /**
       * #slot
       * Renderer options. BaseLinearDisplay (unlike the LinearFeatureDisplay
       * layer, which core does not export to external plugins) does not supply
       * a renderer slot, so declare it here.
       */
      renderer: pluginManager.pluggableConfigSchemaType('renderer'),
    },
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
