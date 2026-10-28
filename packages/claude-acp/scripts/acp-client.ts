#!/usr/bin/env node
/** Shared by the wire tests and a human operator so a protocol bug reproduces the same way for both. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientCapabilities,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationSchema,
  type NewSessionResponse,
  type LoadSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { DECISION_META_KEY } from '../src/permissions';
import { cliCommand } from '../src/test-support/cli';

export interface AcpClientPolicy {
  onPermission?(request: RequestPermissionRequest): Promise<RequestPermissionResponse> | RequestPermissionResponse;
  onElicitation?(request: CreateElicitationRequest): Promise<CreateElicitationResponse> | CreateElicitationResponse;
}

export interface AcpClientOptions {
  /** Built entry point to run instead of the TypeScript source. */
  bin?: string;
  /** Launch arguments for the shim, e.g. ['--config-dir', dir, '--', ...claudeFlags]. */
  args?: string[];
  env?: NodeJS.ProcessEnv;
  policy?: AcpClientPolicy;
  onUpdate?: (notification: SessionNotification) => void;
  onDiagnostic?: (text: string) => void;
}

/** Drives one claude-acp child process over real ACP framing; the transport under test is the wire, not a mock. */
export class AcpClient {
  private child?: ChildProcessWithoutNullStreams;
  private connection?: ClientSideConnection;
  private stderrText = '';
  readonly updates: SessionNotification[] = [];

  constructor(private options: AcpClientOptions = {}) {}

  connect(): void {
    if (this.child) throw new Error('AcpClient is already connected');
    const launch = this.options.bin ? { command: process.execPath, args: [this.options.bin, ...(this.options.args ?? [])] } : cliCommand(this.options.args);
    this.child = spawn(launch.command, launch.args, { env: this.options.env ?? process.env, stdio: 'pipe' });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => { this.stderrText += chunk; this.options.onDiagnostic?.(chunk); });
    const policy = this.options.policy ?? {};
    this.connection = new ClientSideConnection(() => ({
      sessionUpdate: async (params) => { this.updates.push(params); this.options.onUpdate?.(params); },
      requestPermission: async (params) =>
        (await policy.onPermission?.(params)) ?? { outcome: { outcome: 'cancelled' } },
      createElicitation: async (params) =>
        (await policy.onElicitation?.(params)) ?? { action: 'cancel' },
    }), ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout)));
  }

  private conn(): ClientSideConnection {
    if (!this.connection) throw new Error('connect() must be called first');
    return this.connection;
  }

  initialize(clientCapabilities: ClientCapabilities = { elicitation: { form: {} } }) {
    return this.conn().initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities });
  }
  newSession(params: { cwd: string; mcpServers?: unknown[] }): Promise<NewSessionResponse> {
    return this.conn().newSession({ mcpServers: [], ...params } as never);
  }
  loadSession(params: { cwd: string; sessionId: string; mcpServers?: unknown[] }): Promise<LoadSessionResponse> {
    return this.conn().loadSession({ mcpServers: [], ...params } as never);
  }
  prompt(params: { sessionId: string; prompt: ContentBlock[] }): Promise<PromptResponse> {
    return this.conn().prompt(params);
  }
  cancel(params: { sessionId: string }): Promise<void> {
    return this.conn().cancel(params);
  }

  /** Updates carrying agent-visible text, in stream order, for scenarios that only need the transcript. */
  text(): string[] {
    const out: string[] = [];
    for (const notification of this.updates) {
      const update = notification.update as { sessionUpdate: string; content?: { type: string; text?: string } };
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') out.push(update.content.text);
    }
    return out;
  }

  get diagnostics(): string { return this.stderrText; }

  /** Ends the child's stdin and waits for exit; a hung child here would hang every caller of this method. */
  async close(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (!this.child) return { code: null, signal: null };
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
    child.stdin.end();
    return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  }
}

/** Reads a local image file into the ACP content block shape, guessing MIME type from the extension. */
export async function imageBlock(path: string): Promise<ContentBlock> {
  const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[extname(path).toLowerCase()];
  if (!mimeType) throw new Error(`Cannot infer an image MIME type from ${path}`);
  const data = await readFile(path);
  return { type: 'image', mimeType, data: data.toString('base64') };
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

/** Human-operator REPL: types prompts, answers permission/question prompts inline, `/cancel` interrupts, `/quit` exits. */
async function main(): Promise<void> {
  // pnpm forwards its own `--` separator, so a leading one is not the claude-flags separator.
  const argv = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2);
  const separator = argv.indexOf('--');
  const args = separator === -1 ? argv : argv.slice(0, separator);
  const claudeArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  if (args.includes('-h') || args.includes('--help')) {
    console.log([
      'Usage: pnpm --filter @candy-mountain/claude-acp acp-client [options] [-- <claude flags>]',
      '  --bin <path>          built claude-acp entry point (default: run src/cli.ts through tsx)',
      '  --claude-dir <path>   Directory containing a `claude` binary to prepend to PATH',
      '  --cwd <dir>           Session working directory (default: current directory)',
      '  --resume <sessionId>  Load an existing session instead of creating one',
      '  --config-dir <dir>    CLAUDE_CONFIG_DIR for the child (default: a fresh, logged-out temp directory)',
      '  --prompt <text>       Send one prompt and exit instead of starting the REPL',
      '  --image <path>        Attach an image to that single --prompt',
    ].join('\n'));
    return;
  }
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = resolve(flag('--cwd') ?? process.cwd());
  const claudeDir = flag('--claude-dir');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(claudeDir ? { PATH: `${resolve(claudeDir)}:${process.env.PATH ?? ''}` } : {}),
  };
  const configDir = resolve(flag('--config-dir') ?? await mkdtemp(join(tmpdir(), 'claude-acp-operator-')));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const client = new AcpClient({
    bin: flag('--bin'),
    args: ['--config-dir', configDir, '--', ...claudeArgs],
    env,
    onUpdate: (n) => printUpdate(n),
    onDiagnostic: (text) => process.stderr.write(text),
    policy: { onPermission: (r) => interactivePermission(rl, r), onElicitation: (r) => interactiveElicitation(rl, r) },
  });
  client.connect();
  try {
    await client.initialize();
    const resume = flag('--resume');
    const sessionId = resume ?? (await client.newSession({ cwd })).sessionId;
    if (resume) await client.loadSession({ cwd, sessionId });
    console.log(`Session ready: ${sessionId}`);

    const singlePrompt = flag('--prompt');
    if (singlePrompt !== undefined) {
      const image = flag('--image');
      const prompt: ContentBlock[] = image ? [await imageBlock(image), { type: 'text', text: singlePrompt }] : [{ type: 'text', text: singlePrompt }];
      const result = await client.prompt({ sessionId, prompt });
      console.log(`\nstopReason: ${result.stopReason}`);
      return;
    }
    console.log('Type a prompt and press enter. Commands: /cancel, /quit.');
    for (;;) {
      const line = await rl.question('> ');
      if (line === '/quit' || line === '/exit') break;
      if (line === '/cancel') { await client.cancel({ sessionId }); continue; }
      if (!line.trim()) continue;
      const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: line }] });
      console.log(`[stopReason: ${result.stopReason}]`);
    }
  } finally {
    rl.close();
    await client.close();
  }
}

function printUpdate(notification: SessionNotification): void {
  const update = notification.update as { sessionUpdate: string; content?: { type: string; text?: string }; title?: string; status?: string };
  if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') process.stdout.write(update.content.text ?? '');
  else if (update.sessionUpdate === 'tool_call') console.log(`\n[tool] ${update.title} (${update.status})`);
  else if (update.sessionUpdate === 'tool_call_update' && update.status) console.log(`\n[tool] ${update.status}`);
}

async function interactivePermission(rl: ReturnType<typeof createInterface>, request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
  console.log(`\n--- Permission request: ${request.toolCall.title ?? request.toolCall.toolCallId} ---`);
  for (const item of request.toolCall.content ?? []) if (item.type === 'content' && item.content.type === 'text') console.log(item.content.text);
  request.options.forEach((option, index) => console.log(`  ${index + 1}) ${option.name} [${option.kind}]`));
  const answer = await rl.question('Choose an option number (blank cancels): ');
  const chosen = request.options[Number(answer) - 1];
  if (!chosen) return { outcome: { outcome: 'cancelled' } };
  if (chosen.kind === 'reject_once' || chosen.kind === 'reject_always') {
    const explanation = await rl.question('Explanation for Claude (optional): ');
    return { outcome: { outcome: 'selected', optionId: chosen.optionId }, ...(explanation.trim() ? { _meta: { [DECISION_META_KEY]: { explanation: explanation.trim() } } } : {}) };
  }
  return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
}

/** Loose shape covering the string/array variants the bridge actually emits; the SDK's schema type is open-ended (a bare `type: string` catch-all arm), so a cast here beats fighting that union member-by-member. */
type SimpleProperty = { title?: string | null; description?: string | null; type: string; oneOf?: Array<{ const: string; title?: string }>; items?: { enum?: string[] } };

async function interactiveElicitation(rl: ReturnType<typeof createInterface>, request: CreateElicitationRequest): Promise<CreateElicitationResponse> {
  console.log(`\n--- Clarifying question ---\n${request.message}`);
  // The bridge only ever issues form-mode elicitations; url-mode is a different ACP flow this shim does not use.
  if (request.mode !== 'form') return { action: 'cancel' };
  const schema = (request as { requestedSchema: ElicitationSchema }).requestedSchema;
  const properties = (schema.properties ?? {}) as Record<string, SimpleProperty>;
  const content: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    console.log(`${property.title ?? key}${property.description ? `\n${property.description}` : ''}`);
    if (property.type === 'string' && property.oneOf) {
      property.oneOf.forEach((option, index) => console.log(`  ${index + 1}) ${option.title ?? option.const}`));
      const answer = await rl.question('Answer (number, or free text): ');
      const index = Number(answer) - 1;
      content[key] = property.oneOf[index] ? property.oneOf[index]!.const : answer;
    } else if (property.type === 'array' && property.items?.enum) {
      const options = property.items.enum;
      options.forEach((option, index) => console.log(`  ${index + 1}) ${option}`));
      const answer = await rl.question('Answer (comma-separated numbers): ');
      content[key] = answer.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const i = Number(s) - 1; return options[i] ?? s; });
    } else {
      content[key] = await rl.question('Answer: ');
    }
  }
  return { action: 'accept', content };
}
