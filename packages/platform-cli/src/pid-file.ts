import { readFileSync, rmSync, writeFileSync } from 'node:fs'

export interface PidRecord {
  pid: number
  entry: string
  host: string
  port: number
  startedAt: string
  /** Set when a foreground `run` owns the process rather than a detached start. */
  supervisor?: number
}

export function readPidFile(path: string): PidRecord | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  }
  catch {
    return undefined
  }
  try {
    const record = JSON.parse(raw) as Partial<PidRecord>
    return Number.isInteger(record.pid) && typeof record.entry === 'string' ? (record as PidRecord) : undefined
  }
  catch {
    return undefined
  }
}

export function writePidFile(path: string, record: PidRecord): void {
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
}

export function removePidFile(path: string): void {
  rmSync(path, { force: true })
}

export function isRunning(record: Pick<PidRecord, 'pid' | 'entry'>): boolean {
  try {
    process.kill(record.pid, 0)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false
  }
  return matchesProcess(record)
}

// Guards against a recycled pid: the process must still be a live node running our entry.
function matchesProcess({ pid, entry }: Pick<PidRecord, 'pid' | 'entry'>): boolean {
  let cmdline: string
  let stat: string
  try {
    cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  }
  catch {
    return process.platform !== 'linux'
  }
  const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
  return state !== 'Z' && cmdline.split('\0').includes(entry)
}
