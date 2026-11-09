import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AcpSessionEvent } from './events'
import type { AcpSession } from './session'

export interface TempHome {
  root: string
  cwd: string
  configHome: string
  cleanup(): void
}

export function createTempHome(prefix = 'cm-acp-'): TempHome {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cwd: join(root, 'checkout'), configHome: join(root, 'config-home'), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export const textOf = (events: AcpSessionEvent[]) => events.flatMap(event => (event.kind === 'text' && event.role === 'agent' ? [event.text] : []))

export function collect(session: AcpSession, into: AcpSessionEvent[] = []): AcpSessionEvent[] {
  session.subscribe(event => into.push(event))
  return into
}

export function waitForEvent<K extends AcpSessionEvent['kind']>(session: AcpSession, kind: K, timeoutMs = 10_000): Promise<Extract<AcpSessionEvent, { kind: K }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No ${kind} event within ${timeoutMs}ms`)) }, timeoutMs)
    const unsubscribe = session.subscribe((event) => {
      if (event.kind !== kind) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event as Extract<AcpSessionEvent, { kind: K }>)
    })
  })
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

export async function waitForGone(pid: number, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now()
  while (processAlive(pid)) {
    if (Date.now() - started > timeoutMs) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return true
}
