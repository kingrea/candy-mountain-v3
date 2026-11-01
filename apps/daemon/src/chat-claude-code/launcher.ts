import { assertClaudeNeverBypass } from '../acp'
import { claudeCodeLaunchContext } from '../plugins/claude-code/launch'
import { SessionError, type SessionLauncher } from '../sessions'

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const claudeCodeLauncher: SessionLauncher = {
  assertPosture(posture) {
    if (posture.flags) assertClaudeNeverBypass(posture.flags)
  },
  launch(row, base, deps) {
    let context
    try {
      context = claudeCodeLaunchContext(deps, row.projectId)
    }
    catch (error) {
      throw new SessionError('family_unavailable', errorMessage(error))
    }
    if (!context) throw new SessionError('family_unavailable', 'The Claude Code plugin is not set up for this project.')
    return { ...base, configHome: context.configDir, command: context.command, env: { ...row.posture?.env, ...context.env }, flags: row.posture?.flags }
  },
}
