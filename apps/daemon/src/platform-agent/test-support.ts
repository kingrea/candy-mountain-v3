import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface StubChatMessage {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: { id: string, function: { name: string, arguments: string } }[]
}

export interface StubGatewayRequest {
  model: string
  messages: StubChatMessage[]
  tools: string[]
  authorization: string | undefined
}

export type StubGatewayReply =
  | { text: string }
  | { toolCall: { name: string, args: Record<string, unknown> } }

export interface StubGateway {
  url: string
  requests: StubGatewayRequest[]
  close(): Promise<void>
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sse(res: ServerResponse, model: string, reply: StubGatewayReply): void {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(chunk({ role: 'assistant', content: '' }, null))
  if ('text' in reply) {
    for (const word of reply.text.split(/(?<= )/)) res.write(chunk({ content: word }, null))
    res.write(chunk({}, 'stop'))
  }
  else {
    res.write(chunk({ tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args) } }] }, null))
    res.write(chunk({}, 'tool_calls'))
  }
  res.end('data: [DONE]\n\n')
}

/** Speaks just enough of the OpenAI chat completions API (streaming and not) for the Mastra router to talk to it. */
export function startStubGateway(reply: (request: StubGatewayRequest) => StubGatewayReply, port = 0): Promise<StubGateway> {
  const requests: StubGatewayRequest[] = []
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    const body = await readJson(req)
    const request: StubGatewayRequest = {
      model: String(body.model),
      messages: (body.messages as StubChatMessage[]) ?? [],
      tools: ((body.tools as { function: { name: string } }[]) ?? []).map(tool => tool.function.name),
      authorization: req.headers.authorization,
    }
    requests.push(request)
    const answer = reply(request)
    if (body.stream) {
      sse(res, request.model, answer)
      return
    }
    const message = 'text' in answer
      ? { role: 'assistant', content: answer.text }
      : { role: 'assistant', content: null, tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.args) } }] }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'stub', object: 'chat.completion', created: 0, model: request.model, choices: [{ index: 0, message, finish_reason: 'text' in answer ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${bound}/v1`, requests, close: () => new Promise(done => server.close(() => done())) })
    })
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** A canned model: picks a tool from the prompt's wording and answers from the tool's result. */
export function scriptedReply(request: StubGatewayRequest): StubGatewayReply {
  const last = request.messages.at(-1)
  if (!last) return { text: 'Nothing to say.' }
  if (last.role === 'tool') {
    let result: unknown
    try {
      result = JSON.parse(last.content ?? '')
    }
    catch {
      result = last.content
    }
    if (!isRecord(result)) return { text: `Tool said: ${String(last.content)}` }
    if (result.refused === true) return { text: `I can't do that: ${String(result.reason)}` }
    if (typeof result.summary === 'string') return { text: result.summary }
    const views = Array.isArray(result.views) ? result.views.map(view => (isRecord(view) ? String(view.label) : '')).filter(Boolean) : []
    const agents = Array.isArray(result.agents) ? result.agents.map(agent => (isRecord(agent) ? String(agent.label) : '')).filter(Boolean) : []
    const project = isRecord(result.project) ? String(result.project.name) : 'this project'
    return { text: `In ${project} you can open ${views.length ? views.join(', ') : 'no views'} and chat with ${agents.length ? agents.join(', ') : 'no other agents'}.` }
  }
  const prompt = (last.content ?? '').trim()
  const open = /^open (\S+)/i.exec(prompt)
  if (open) return { toolCall: { name: 'open_view', args: { viewId: open[1]! } } }
  const chat = /^chat with (\S+)/i.exec(prompt)
  if (chat) return { toolCall: { name: 'start_chat', args: { agentId: chat[1]! } } }
  if (/describe|what can/i.test(prompt)) return { toolCall: { name: 'describe_platform', args: {} } }
  return { text: `Echo: ${prompt}` }
}
