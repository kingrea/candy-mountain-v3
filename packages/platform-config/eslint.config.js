import base from '@candy-mountain/platform-config/eslint'

export default [
  ...base,
  // Fixtures break the package rules on purpose; test/unit/package-boundaries.test.ts lints them.
  { ignores: ['test/fixtures/**'] },
]
