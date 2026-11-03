import type { Actor, AgentSession, AgentSessionEventPayload, AgentSessionFamily, ChatThread, Workspace } from '../index'

/** A turn the daemon runs itself for a family no harness launches; rows go through `emit`, cancel arrives on `signal`. */
export interface NativeTurn {
  emit(payload: AgentSessionEventPayload): void
  signal: AbortSignal
}
export type NativeTurnRunner = (turn: NativeTurn) => Promise<void>

/** One turn of a thread whose family runs inside the daemon instead of through a session harness. */
export interface NativeFamilyTurn extends NativeTurn {
  workspace: Workspace
  actor: Actor
  thread: ChatThread
  session: AgentSession
  text: string
}
export type NativeFamilyRunner = (turn: NativeFamilyTurn) => Promise<void>
export type NativeFamilyRunners = Partial<Record<AgentSessionFamily, NativeFamilyRunner>>
