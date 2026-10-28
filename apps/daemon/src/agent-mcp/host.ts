import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentSession } from '@candy-mountain/shared'
import type { LaunchMcpServer } from '../acp'
import type { Db } from '../db'
import { findSession } from '../sessions/store'

export interface AgentMcpToolResult {
  text: string
  isError?: boolean
}

export interface AgentMcpToolContext {
  session: AgentSession
  signal: AbortSignal
}

export interface AgentMcpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  call(args: Record<string, unknown>, context: AgentMcpToolContext): Promise<AgentMcpToolResult>
}

export interface AgentMcpServerDefinition {
  name: string
  /** Asked at launch and again on every request, so a session that leaves the scope loses the server at once. */
  appliesTo(session: AgentSession): boolean
  tools: readonly AgentMcpTool[]
}

export interface AgentMcpHostDeps {
  db: Db
  servers: readonly AgentMcpServerDefinition[]
}

export interface AgentMcpHost {
  /** The servers one launch of the session registers; the listener starts on first use. */
  serversFor(session: AgentSession): Promise<LaunchMcpServer[]>
  close(): Promise<void>
}

export const AGENT_MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
export const AGENT_MCP_BODY_MAX = 1024 * 1024

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: unknown
  params?: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const rpcResult = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })

function sameToken(expected: string, given: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > AGENT_MCP_BODY_MAX) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    response.writeHead(status, headers).end()
    return
  }
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body))
}

/**
 * Daemon-hosted MCP servers over stateless Streamable HTTP on loopback: each session gets its own bearer token per daemon boot,
 * and every request is answered as a single JSON response (no SSE stream).
 */
export function startAgentMcpHost({ db, servers }: AgentMcpHostDeps): AgentMcpHost {
  const byName = new Map(servers.map(server => [server.name, server]))
  const tokens = new Map<string, string>()
  const controller = new AbortController()
  let listening: Promise<number> | null = null
  let closed = false

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, rpcError(null, -32603, 'Internal error'))
      else response.end()
    })
  })

  function listen(): Promise<number> {
    listening ??= new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve((server.address() as AddressInfo).port)
      })
    })
    return listening
  }

  function tokenFor(serverName: string, sessionId: string): string {
    const key = `${serverName}/${sessionId}`
    let token = tokens.get(key)
    if (!token) {
      token = randomBytes(32).toString('base64url')
      tokens.set(key, token)
    }
    return token
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const port = (server.address() as AddressInfo | null)?.port
    // A browser page could otherwise reach the loopback port through DNS rebinding.
    if (request.headers.origin !== undefined || request.headers.host !== `127.0.0.1:${port}`) return send(response, 403, rpcError(null, -32600, 'Forbidden'))
    const match = /^\/mcp\/([a-z0-9_]+)\/([\w-]+)$/.exec(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    const definition = match ? byName.get(match[1]!) : undefined
    if (!match || !definition) return send(response, 404, rpcError(null, -32600, 'No such MCP server'))
    const sessionId = match[2]!
    const expected = tokens.get(`${definition.name}/${sessionId}`)
    const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
    if (!expected || !given || !sameToken(expected, given)) return send(response, 401, rpcError(null, -32600, 'Unauthorized'))
    if (request.method !== 'POST') return send(response, 405, undefined, { Allow: 'POST' })
    const session = findSession(db, sessionId)
    if (!session || !definition.appliesTo(session)) return send(response, 404, rpcError(null, -32600, 'This session no longer has the server'))

    const text = await readBody(request)
    if (text === null) return send(response, 413, rpcError(null, -32600, 'Request body too large'))
    let message: unknown
    try {
      message = JSON.parse(text)
    }
    catch {
      return send(response, 400, rpcError(null, -32700, 'Parse error'))
    }
    const batch = Array.isArray(message)
    const requests = (batch ? message : [message]) as unknown[]
    const replies = []
    for (const item of requests) {
      const reply = await answer(definition, session, item)
      if (reply) replies.push(reply)
    }
    if (!replies.length) return send(response, 202)
    send(response, 200, batch ? replies : replies[0])
  }

  async function answer(definition: AgentMcpServerDefinition, session: AgentSession, item: unknown): Promise<object | null> {
    if (!isObject(item) || item.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid request')
    const rpc = item as unknown as JsonRpcRequest
    // Notifications and responses need no reply.
    if (rpc.id === undefined || typeof rpc.method !== 'string') return null
    const params = isObject(rpc.params) ? rpc.params : {}
    switch (rpc.method) {
      case 'initialize': {
        const requested = params.protocolVersion
        const protocolVersion = (AGENT_MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(requested) ? requested : AGENT_MCP_PROTOCOL_VERSIONS[0]
        return rpcResult(rpc.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: definition.name, version: '1.0.0' } })
      }
      case 'ping':
        return rpcResult(rpc.id, {})
      case 'tools/list':
        return rpcResult(rpc.id, {
          tools: definition.tools.map(tool => ({ name: tool.name, ...(tool.title ? { title: tool.title } : {}), description: tool.description, inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) })),
        })
      case 'tools/call': {
        const tool = definition.tools.find(candidate => candidate.name === params.name)
        if (!tool) return rpcError(rpc.id, -32602, `Unknown tool ${JSON.stringify(params.name)}`)
        const args = params.arguments === undefined ? {} : params.arguments
        if (!isObject(args)) return rpcResult(rpc.id, { content: [{ type: 'text', text: 'The tool arguments must be an object.' }], isError: true })
        let result: AgentMcpToolResult
        try {
          result = await tool.call(args, { session, signal: controller.signal })
        }
        catch (error) {
          result = { text: error instanceof Error ? error.message : String(error), isError: true }
        }
        return rpcResult(rpc.id, { content: [{ type: 'text', text: result.text }], isError: result.isError === true })
      }
      default:
        return rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`)
    }
  }

  return {
    async serversFor(session) {
      const applicable = servers.filter(definition => definition.appliesTo(session))
      if (!applicable.length || closed) return []
      const port = await listen()
      return applicable.map(definition => ({
        name: definition.name,
        url: `http://127.0.0.1:${port}/mcp/${definition.name}/${session.id}`,
        bearerToken: tokenFor(definition.name, session.id),
        tools: definition.tools.map(tool => tool.name),
      }))
    },
    async close() {
      if (closed) return
      closed = true
      controller.abort()
      tokens.clear()
      if (!listening) return
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}
