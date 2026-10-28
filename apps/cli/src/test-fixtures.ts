import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type { Io } from './commands'

export const FAKE_DAEMON = `
import { createServer } from 'node:http'
const server = createServer((req, res) => res.end(JSON.stringify({ status: 'ok' })))
server.listen(Number(process.env.CM_DAEMON_PORT), process.env.CM_DAEMON_HOST)
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`

export const FAKE_WEB = `
import { createServer } from 'node:http'
const server = createServer(async (req, res) => {
  const upstream = await fetch(process.env.NUXT_DAEMON_URL + req.url.replace(/^\\/api/, ''))
  res.end(await upstream.text())
})
server.listen(Number(process.env.PORT), process.env.HOST)
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

export function capture(): Io & { lines: string[] } {
  const lines: string[] = []
  return { lines, out: (line) => lines.push(line), err: (line) => lines.push(line) }
}

export function writeEntry(root: string, path: string, source: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), source)
}
