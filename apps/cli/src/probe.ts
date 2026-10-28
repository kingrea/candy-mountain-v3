import { connect } from 'node:net'
import { isHealthResponse } from '@candy-mountain/shared'
import { connectHost, type Address } from '@candy-mountain/config'

export async function isHealthy(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok && isHealthResponse(await res.json())
  }
  catch {
    return false
  }
}

export function isPortInUse({ host, port }: Address): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: connectHost(host), port })
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
