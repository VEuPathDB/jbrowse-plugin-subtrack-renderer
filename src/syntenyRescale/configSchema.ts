import { ConfigurationSchema } from '@jbrowse/core/configuration'

/**
 * #config SyntenyRescaleAdapter
 */
export default ConfigurationSchema(
  'SyntenyRescaleAdapter',
  {
    /**
     * #slot
     * The adapter holding the synteny GFF. Everything about reading the file is
     * its business; this adapter only repositions what comes out.
     */
    subadapter: {
      type: 'frozen',
      defaultValue: {},
      description: 'the adapter supplying the syntenic features',
    },
    /**
     * #slot
     * Attribute naming the gene's position on its own genome. Rescaling is what
     * spaces paralogs apart and keeps insertions visible; without these the
     * adapter passes features through untouched.
     */
    nativeStartAttribute: {
      type: 'string',
      defaultValue: 'nativeStart',
      description: "attribute holding the feature's start on its own genome",
    },
    /**
     * #slot
     */
    nativeEndAttribute: {
      type: 'string',
      defaultValue: 'nativeEnd',
      description: "attribute holding the feature's end on its own genome",
    },
    /**
     * #slot
     * Attribute grouping features that rescale together — one syntenic span.
     */
    spanAttribute: {
      type: 'string',
      defaultValue: 'syntenyId',
      description: 'attribute identifying the syntenic span',
    },
    /**
     * #slot
     * Attribute holding `1` when the span runs antiparallel to the reference.
     */
    reversedAttribute: {
      type: 'string',
      defaultValue: 'spanIsReversed',
      description: 'attribute set when the span is reversed',
    },
    /**
     * #slot
     * Attribute naming the ortholog group, which the adapter folds into the
     * feature id so the ribbon overlay can read it on the main thread.
     */
    orthologGroupAttribute: {
      type: 'string',
      defaultValue: 'orthologGroup',
      description: "attribute holding the feature's ortholog group",
    },
    /**
     * #slot
     * Feature types the rescale applies to. A span bar marks the extent it was
     * computed over, so moving it would be circular.
     */
    rescaleTypes: {
      type: 'stringArray',
      defaultValue: ['gene'],
      description: 'feature types to reposition',
    },
  },
  { explicitlyTyped: true },
)
