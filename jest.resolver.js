/**
 * @jbrowse/core 4.x is ESM-only -- its package exports declare `types` and
 * `import` conditions but no `require` -- so jest cannot resolve it under the
 * default conditions and every suite dies at import time.
 *
 * Setting testEnvironmentOptions.customExportConditions to ['node','import']
 * globally does fix that, but it also forces jest's OWN dependencies to resolve
 * to their ESM builds (jest-circus pulls in dedent, which then arrives as a raw
 * .mjs that the CJS runtime cannot execute).
 *
 * So: ask for the ESM build only from the packages that require it, and let
 * everything else resolve the normal CJS way.
 */
const ESM_ONLY = /^@jbrowse\//

module.exports = (request, options) =>
  options.defaultResolver(request, {
    ...options,
    conditions: ESM_ONLY.test(request)
      ? ['node', 'import']
      : ['node', 'require'],
  })
