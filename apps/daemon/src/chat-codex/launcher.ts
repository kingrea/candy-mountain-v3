import { assertCodexLaunchOptions } from '../acp'
import { codexLaunchContext } from '../plugins/codex/launch'
import { SessionError, type SessionLauncher } from '../sessions'

export const codexLauncher: SessionLauncher = {
  assertPosture(posture) {
    if (posture.codex) assertCodexLaunchOptions(posture.codex)
  },
  launch(row, base, deps) {
    const context = codexLaunchContext(deps, row.projectId)
    if (!context) throw new SessionError('family_unavailable', 'The Codex plugin is not set up for this project.')
    return { ...base, configHome: context.home, command: context.command, env: row.posture?.env, codex: row.posture?.codex }
  },
}
