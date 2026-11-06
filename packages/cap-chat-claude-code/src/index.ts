export { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, chatClaudeCodeDefinition, chatClaudeCodeRoutes, CLAUDE_CODE_FAMILY, type ChatClaudeCodeOptions } from './definition'
export { claudeCodeLauncher } from './launcher'
export { chatClaudeCodeCapability } from './manifest'
export * from './acp'
export * from './sessions'
export * from './decisions'
export * from './plugin-type'
export * from './wire'

// Test support, kept free of vitest so the root entry stays safe to bundle.
export * from './acp/test-support'
