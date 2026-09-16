import type stateModelFactory from '@jbrowse/plugin-canvas/LinearBasicDisplay/stateModel'

// Derived from the real factory rather than hand-written: upstream drift
// becomes a compile error here instead of a silently wrong augmentation.
type LinearBasicDisplayStateModel = ReturnType<typeof stateModelFactory>

declare module '@jbrowse/core/PluginManager' {
  interface DisplayTypeRegistry {
    LinearBasicDisplay: LinearBasicDisplayStateModel
  }
}
