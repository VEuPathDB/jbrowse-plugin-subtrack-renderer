/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',

  // @jbrowse/core 4.x is ESM-only, and jest's own deps are not. See the comment
  // in jest.resolver.js -- a blanket customExportConditions breaks jest-circus.
  resolver: '<rootDir>/jest.resolver.js',
  setupFiles: ['<rootDir>/jest.setup.js'],

  // Feature branches live in .worktrees/ (see .gitignore). Jest only ignores
  // node_modules by default, so without this it collects each test twice -- once
  // from src/ and once from every worktree -- silently doubling the reported
  // counts and the runtime.
  testPathIgnorePatterns: ['/node_modules/', '/\\.worktrees/'],
  modulePathIgnorePatterns: ['/\\.worktrees/'],

  // Having resolved @jbrowse/* to ESM, it has to be down-levelled to CJS. jest
  // does not transform node_modules by default, so allow the @jbrowse packages
  // and the ESM-only libraries they pull in through.
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(@jbrowse\\+|@gmod\\+|flatbush|flatqueue|generic-filehandle|quick-lru|nanoid|rxjs))',
  ],

  transform: {
    // transpile only -- do NOT type-check in jest.
    //
    // ts-jest type-checks each file in isolation, which does not see the ambient
    // declaration that pulls in core's MUI palette augmentation, so it rejects
    // `theme.palette.framesCDS` even though `tsc --noEmit` is perfectly happy
    // with it. Type checking is `tsc --noEmit`'s job (and it is clean); jest's
    // job is to run the code. This also makes the suite substantially faster.
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: 'tsconfig.test.json', isolatedModules: true },
    ],
    '^.+\\.m?jsx?$': ['babel-jest', { configFile: './babel.jest.js' }],
  },
}
