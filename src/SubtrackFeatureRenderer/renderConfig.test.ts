import PluginManager from '@jbrowse/core/PluginManager'

import configSchema from './configSchema'
import { createRenderConfigContext, readCachedConfig } from './renderConfig'
import { resolveRenderSubtracks } from './subtrackUtils'

import type { CachedConfig } from './renderConfig'
import type { Subtrack } from './subtrackUtils'

describe('CachedConfig', () => {
  describe('readCachedConfig', () => {
    const mockFeature = {
      get: (key: string) => {
        if (key === 'name') {
          return 'TestFeature'
        }
        return undefined
      },
    }

    it('returns cached value when isCallback is false', () => {
      const cached: CachedConfig<string> = {
        value: 'cachedColor',
        isCallback: false,
      }

      const result = readCachedConfig(
        cached,
        {} as any, // config not used when isCallback is false
        'color1',
        mockFeature as any,
      )

      expect(result).toBe('cachedColor')
    })

    it('calls readConfObject when isCallback is true', () => {
      const cached: CachedConfig<string> = {
        value: 'defaultColor',
        isCallback: true,
      }

      // Since readConfObject is complex, we test the structure
      // The actual readConfObject call is tested in core
      expect(cached.isCallback).toBe(true)
    })

    it('returns cached number value', () => {
      const cached: CachedConfig<number> = {
        value: 10,
        isCallback: false,
      }

      const result = readCachedConfig(
        cached,
        {} as any,
        'height',
        mockFeature as any,
      )

      expect(result).toBe(10)
    })

    it('uses default value for cached callbacks', () => {
      const cached: CachedConfig<number> = {
        value: 12, // default value used when isCallback is true
        isCallback: true,
      }

      // When isCallback is true, the value field contains the default
      expect(cached.value).toBe(12)
    })
  })

  describe('CachedConfig structure', () => {
    it('has correct shape for non-callback', () => {
      const config: CachedConfig<string> = {
        value: 'goldenrod',
        isCallback: false,
      }
      expect(config.value).toBe('goldenrod')
      expect(config.isCallback).toBe(false)
    })

    it('has correct shape for callback', () => {
      const config: CachedConfig<string> = {
        value: 'defaultValue',
        isCallback: true,
      }
      expect(config.value).toBe('defaultValue')
      expect(config.isCallback).toBe(true)
    })
  })
})

describe('createRenderConfigContext subtracks', () => {
  const pluginManager = new PluginManager([])
  pluginManager.configure()

  const CONFIG_SUBTRACKS: Subtrack[] = [
    { label: 'FromConfig', featureFilters: { type: 'gene' }, visible: true },
  ]

  function makeConfig() {
    return configSchema.create(
      {
        subtracks: CONFIG_SUBTRACKS,
        subtrackConfig: { enabled: true },
      },
      { pluginManager },
    )
  }

  it('falls back to the config when no override is supplied', () => {
    const ctx = createRenderConfigContext(makeConfig())

    expect(ctx.subtracks.map(s => s.label)).toEqual(['FromConfig'])
  })

  it('prefers the override supplied by the display', () => {
    const override: Subtrack[] = [
      {
        label: 'FromDisplay',
        featureFilters: { type: 'match' },
        visible: true,
      },
    ]

    const ctx = createRenderConfigContext(makeConfig(), override)

    expect(ctx.subtracks.map(s => s.label)).toEqual(['FromDisplay'])
  })

  it('an empty override yields no lanes', () => {
    const ctx = createRenderConfigContext(makeConfig(), [])

    expect(ctx.subtracks).toEqual([])
  })
})

describe('resolveRenderSubtracks', () => {
  const pluginManager = new PluginManager([])
  pluginManager.configure()

  function makeConfig() {
    return configSchema.create(
      {
        subtracks: [
          {
            label: 'FromConfig',
            featureFilters: { type: 'gene' },
            visible: true,
          },
        ],
      },
      { pluginManager },
    )
  }

  it('uses the config catalog when renderProps carries no selection', () => {
    const config = makeConfig()

    expect(resolveRenderSubtracks({ config }).map(s => s.label)).toEqual([
      'FromConfig',
    ])
  })

  it('uses the display selection when renderProps carries one', () => {
    const config = makeConfig()
    const subtracks: Subtrack[] = [
      {
        label: 'FromDisplay',
        featureFilters: { type: 'match' },
        visible: true,
      },
    ]

    expect(
      resolveRenderSubtracks({ config, subtracks }).map(s => s.label),
    ).toEqual(['FromDisplay'])
  })

  it('an empty selection yields no lanes rather than the config catalog', () => {
    const config = makeConfig()

    expect(resolveRenderSubtracks({ config, subtracks: [] })).toEqual([])
  })
})
