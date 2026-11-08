export { CLAUDE_CODE_CAPABILITY_ID, CLAUDE_CODE_FAMILY, claudeCodeDefinition } from './definition'
export { claudeCodeLauncher } from './launcher'
export * from './plugin-type'
export * from './wire'

// Test support, kept free of vitest so the root entry stays safe to bundle.
export { claudeCodeTestCapabilities } from './test-support'
