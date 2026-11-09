import root from '@crab-shack/platform-config/eslint'

export default [
  ...root,
  // Claude's stream-json and control payloads are untyped JSON that the mapping reads field by field.
  { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
]
