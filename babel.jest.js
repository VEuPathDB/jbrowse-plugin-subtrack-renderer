// Used only by jest, to down-level the ESM that @jbrowse/core 4.x ships to CJS.
// The rollup build does not use this -- see .babelrc / rollup.config.js.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-react',
  ],
}
