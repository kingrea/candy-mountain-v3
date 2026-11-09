import { assertCodexLaunchOptions, type SessionLauncher } from '@candy-mountain/cap-acp'
import { SessionError } from '@crab-shack/platform-daemon'
import { codexLaunchContext } from './plugin-type/launch'

export const codexLauncher: SessionLauncher = {
  assertPosture(posture) {
    if (posture.codex) assertCodexLaunchOptions(posture.codex)
  },
  launch(row, base, deps) {
    const context = codexLaunchContext(deps, row.workspaceId)
    if (!context) throw new SessionError('family_unavailable', 'The Codex plugin is not set up for this project.')
    return { ...base, configHome: context.home, command: context.command, env: row.posture?.env, codex: row.posture?.codex }
  },
}
