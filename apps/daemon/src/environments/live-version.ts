import type { LiveVersion } from '@candy-mountain/shared'

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Numbers are Unix time: seconds below 1e12, milliseconds above, since endpoints use both. */
export function toIsoTime(value: unknown): string | undefined {
  const raw = typeof value === 'number' ? (Math.abs(value) < 1e12 ? value * 1000 : value) : text(value)
  if (raw === undefined) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function toHttpLink(value: unknown, base?: string | URL): string | undefined {
  const raw = text(value)
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  }
  catch {
    return undefined
  }
}

/** Every source's answer passes through here, so the wire shape holds whatever a source returns. */
export function normaliseLiveVersion(raw: LiveVersion): LiveVersion {
  const version: LiveVersion = {}
  const label = text(raw.version)
  const branch = text(raw.branch)
  const deployedAt = toIsoTime(raw.deployedAt)
  const link = toHttpLink(raw.link)
  if (label !== undefined) version.version = label
  if (branch !== undefined) version.branch = branch
  if (deployedAt !== undefined) version.deployedAt = deployedAt
  if (link !== undefined) version.link = link
  return version
}
