import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeEndpoint {
  url: (path: string) => string
  close: () => Promise<void>
}

export async function startFakeEndpoint(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<FakeEndpoint> {
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: path => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

/** A URL nothing listens on: bind a port, then release it. */
export async function unreachableUrl(path = '/version'): Promise<string> {
  const endpoint = await startFakeEndpoint(() => {})
  const url = endpoint.url(path)
  await endpoint.close()
  return url
}

export function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
