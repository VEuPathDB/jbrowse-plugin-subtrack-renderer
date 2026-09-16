import { ConfigurationSchema } from '@jbrowse/core/configuration'

/**
 * #config SubtrackAdapter
 * Wraps another adapter and stamps each feature with the label of the first
 * lane whose filters it matches, for `LinearBasicDisplay` to group on.
 */
export default ConfigurationSchema(
  'SubtrackAdapter',
  {
    /**
     * #slot
     * The lanes, in stacking order. Order is also filter precedence: the first
     * lane whose filters match claims the feature.
     */
    lanes: {
      type: 'frozen',
      defaultValue: [],
      description:
        'array of {label, featureFilters, metadata?} in stacking order; first match wins',
    },
    /**
     * #slot
     * The adapter supplying the features.
     */
    subadapter: {
      type: 'frozen',
      defaultValue: null,
      description: 'the adapter whose features get stamped with a lane',
    },
  },
  { explicitlyTyped: true },
)
