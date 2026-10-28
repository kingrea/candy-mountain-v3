import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { CreateElicitationRequest, CreateElicitationResponse, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { ClaudePermissionBridge, DECISION_META_KEY, type CanUseToolRequest, type ClaudePermissionResult, type PermissionClient } from './permissions';
import { ClaudeProcess } from './process';
import { cliCommand } from './test-support/cli';

const fixture = fileURLToPath(new URL('./test-support/claude-fixture.mjs', import.meta.url));
const childOptions = { command: process.execPath, commandPrefix: [fixture], startupTimeoutMs: 1000, cancelTimeoutMs: 1000 };
const FORM_CAPABLE = { elicitation: { form: {} } };
const suggestion = (destination: string) => ({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git status:*' }], behavior: 'allow', destination });
const bashRequest = (extra: CanUseToolRequest = {}): CanUseToolRequest => ({ tool_name: 'Bash', input: { command: 'git status' }, tool_use_id: 'toolu_1', ...extra });

class StubClient implements PermissionClient {
  permissions: RequestPermissionRequest[] = [];
  elicitations: CreateElicitationRequest[] = [];
  constructor(private answer: {
    permission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse> | RequestPermissionResponse;
    elicitation?: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse> | CreateElicitationResponse;
  } = {}) {}
  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    this.permissions.push(params);
    if (!this.answer.permission) return new Promise<RequestPermissionResponse>(() => {});
    return this.answer.permission(params);
  }
  async createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    this.elicitations.push(params);
    if (!this.answer.elicitation) return new Promise<CreateElicitationResponse>(() => {});
    return this.answer.elicitation(params);
  }
}

const build = (client: PermissionClient, clientCapabilities: unknown = FORM_CAPABLE) =>
  new ClaudePermissionBridge({ sessionId: 'session-1', cwd: tmpdir(), client, clientCapabilities: clientCapabilities as never });

const settled = async <T>(promise: Promise<T>) => {
  const marker = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(marker)])) !== marker;
};

test('a permission-requiring tool stays blocked until the matching answer arrives', async () => {
  const client = new StubClient();
  const bridge = build(client);
  const decision = bridge.handle('req-1', bashRequest());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await settled(decision), false);
  assert.equal(bridge.pendingCount, 1);
  assert.equal(client.permissions.length, 1);
  bridge.close();
  assert.equal((await decision).behavior, 'deny');
  assert.equal(bridge.pendingCount, 0);
});

test('allow once returns the original input and no remembered rule', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } }) });
  const result = await build(client).handle('req-1', bashRequest());
  assert.deepEqual(result, { behavior: 'allow', updatedInput: { command: 'git status' }, toolUseID: 'toolu_1', decisionClassification: 'user_temporary' });
  assert.deepEqual(client.permissions[0]!.options.map(option => option.kind), ['allow_once', 'reject_once']);
  assert.deepEqual(client.permissions[0]!._meta?.[DECISION_META_KEY], { acceptsModifiedInput: true, acceptsExplanation: true });
});

test('a modified input replaces what the tool runs', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' }, _meta: { [DECISION_META_KEY]: { modifiedInput: { command: 'git status --short' } } } }) });
  const result = await build(client).handle('req-1', bashRequest());
  assert.equal(result.behavior, 'allow');
  assert.deepEqual(result.behavior === 'allow' ? result.updatedInput : undefined, { command: 'git status --short' });
});

test('a modified input that is not an object denies instead of running the unapproved input', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' }, _meta: { [DECISION_META_KEY]: { modifiedInput: 'rm -rf /' } } }) });
  const result = await build(client).handle('req-1', bashRequest());
  assert.equal(result.behavior, 'deny');
});

test('a denial carries the caller explanation back to Claude', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' }, _meta: { [DECISION_META_KEY]: { explanation: 'Use the staged diff instead.' } } }) });
  const result = await build(client).handle('req-1', bashRequest());
  assert.deepEqual(result, { behavior: 'deny', message: 'Use the staged diff instead.', toolUseID: 'toolu_1', decisionClassification: 'user_reject' });
});

test('suggested rules become always options that keep their exact scope', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-always-1' } }) });
  const suggestions = [suggestion('localSettings'), suggestion('session')];
  const result = await build(client).handle('req-1', bashRequest({ permission_suggestions: suggestions }));
  const offered = client.permissions[0]!.options;
  assert.deepEqual(offered.map(option => option.kind), ['allow_once', 'allow_always', 'allow_always', 'reject_once']);
  assert.match(offered[1]!.name, /this checkout, privately/);
  assert.match(offered[2]!.name, /this session only/);
  assert.equal(result.behavior, 'allow');
  assert.deepEqual(result.behavior === 'allow' ? result.updatedPermissions : undefined, [suggestions[1]]);
  assert.equal(result.behavior === 'allow' ? result.decisionClassification : undefined, 'user_permanent');
});

test('no always option is offered when Claude suggests nothing or suppresses the rule', async () => {
  for (const request of [bashRequest(), bashRequest({ permission_suggestions: [suggestion('session')], suppress_always_allow_rule: true }), bashRequest({ permission_suggestions: [{ type: 'addRules', behavior: 'deny', destination: 'session', rules: [{ toolName: 'Bash' }] }] })]) {
    const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } }) });
    await build(client).handle('req-1', request);
    assert.equal(client.permissions[0]!.options.filter(option => option.kind === 'allow_always').length, 0);
  }
});

test('an option that was never offered cannot approve the action', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-always-0' } }) });
  const result = await build(client).handle('req-1', bashRequest());
  assert.equal(result.behavior, 'deny');
  assert.match(result.behavior === 'deny' ? result.message : '', /never offered/);
});

test('cancelled, disconnected, stale and mismatched requests all resolve as denials', async () => {
  const cancelled = await build(new StubClient({ permission: () => ({ outcome: { outcome: 'cancelled' } }) })).handle('req-1', bashRequest());
  assert.equal(cancelled.behavior, 'deny');

  const disconnected = await build(new StubClient({ permission: () => Promise.reject(new Error('connection closed')) })).handle('req-1', bashRequest());
  assert.equal(disconnected.behavior, 'deny');

  const bridge = build(new StubClient());
  const pending = bridge.handle('req-1', bashRequest());
  const duplicate = await bridge.handle('req-1', bashRequest());
  assert.equal(duplicate.behavior, 'deny');
  bridge.cancel('req-1');
  assert.equal((await pending).behavior, 'deny');
  assert.equal(bridge.pendingCount, 0);

  const closed = build(new StubClient());
  closed.close();
  assert.equal((await closed.handle('req-2', bashRequest())).behavior, 'deny');

  const malformed = await build(new StubClient()).handle('req-3', { tool_name: 'Bash', input: 'not-an-object' });
  assert.equal(malformed.behavior, 'deny');
});

test('a clarifying question keeps its options, accepts free text and answers by question text', async () => {
  const questions = [
    { question: 'Which formatter?', header: 'Format', options: [{ label: 'prettier', description: 'opinionated' }, { label: 'dprint', description: 'fast' }], multiSelect: false },
    { question: 'Which targets?', header: 'Targets', options: [{ label: 'web' }, { label: 'node' }], multiSelect: true },
  ];
  const client = new StubClient({ elicitation: () => ({ action: 'accept', content: { question_0: 'biome, actually', question_1: ['web', 'node'] } }) });
  const result = await build(client).handle('req-1', { tool_name: 'AskUserQuestion', input: { questions }, tool_use_id: 'toolu_q' });

  const asked = client.elicitations[0]!;
  assert.equal(asked.mode, 'form');
  assert.deepEqual(asked._meta?.[DECISION_META_KEY], { freeText: ['question_0'] });
  const schema = (asked as { requestedSchema: { properties: Record<string, any>; required: string[] } }).requestedSchema;
  assert.deepEqual(schema.properties.question_0.oneOf.map((option: { const: string }) => option.const), ['prettier', 'dprint']);
  assert.deepEqual(schema.properties.question_1.items.enum, ['web', 'node']);
  assert.deepEqual(schema.required, ['question_0', 'question_1']);

  assert.equal(result.behavior, 'allow');
  assert.deepEqual(result.behavior === 'allow' ? result.updatedInput : undefined, {
    questions,
    answers: { 'Which formatter?': 'biome, actually', 'Which targets?': 'web, node' },
  });
});

test('a question is never reduced to a permission when the client cannot present one', async () => {
  const client = new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } }) });
  const result = await build(client, {}).handle('req-1', { tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false }] } });
  assert.equal(result.behavior, 'deny');
  assert.equal(client.permissions.length, 0);
  assert.equal(client.elicitations.length, 0);
});

test('declined, cancelled, unanswered and malformed questions never answer for the caller', async () => {
  for (const answer of [{ action: 'decline' as const }, { action: 'cancel' as const }, { action: 'accept' as const, content: {} }]) {
    const result = await build(new StubClient({ elicitation: () => answer })).handle('req-1', { tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false }] } });
    assert.equal(result.behavior, 'deny');
  }
  const malformed = await build(new StubClient()).handle('req-1', { tool_name: 'AskUserQuestion', input: { questions: 'nope' } });
  assert.equal(malformed.behavior, 'deny');
});

const runChild = async (prompt: string, client: PermissionClient, capabilities: unknown = FORM_CAPABLE) => {
  const bridge = build(client, capabilities);
  const session = new ClaudeProcess(randomUUID(), { ...childOptions, onCanUseTool: (id, request) => bridge.handle(id, request), onCancelPermission: id => bridge.cancel(id) });
  try {
    await session.start(tmpdir());
    const result = await session.prompt([{ type: 'text', text: prompt }]);
    return { result: result.result as string, bridge };
  } finally { session.close(); bridge.close(); }
};

test('the child receives the caller decision on its own permission tool call', async () => {
  const { result } = await runChild('permission', new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-always-0' } }) }));
  const delivered = JSON.parse(result) as { scenario: string; response: ClaudePermissionResult };
  assert.equal(delivered.scenario, 'permission');
  assert.equal(delivered.response.behavior, 'allow');
  assert.deepEqual(delivered.response.behavior === 'allow' ? delivered.response.updatedPermissions : undefined, [suggestion('localSettings')]);
  assert.equal(delivered.response.toolUseID, 'toolu_perm');
});

test('a legacy request without a tool use id still round-trips a denial', async () => {
  const { result } = await runChild('permission:legacy', new StubClient({ permission: () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } }) }));
  const delivered = JSON.parse(result) as { response: ClaudePermissionResult };
  assert.equal(delivered.response.behavior, 'deny');
  assert.equal(delivered.response.toolUseID, undefined);
});

test('a child that abandons its permission request gets no late approval', async () => {
  let resolve!: (response: RequestPermissionResponse) => void;
  const client = new StubClient({ permission: () => new Promise<RequestPermissionResponse>(settle => { resolve = settle; }) });
  const { result, bridge } = await runChild('permission:abandon', client);
  assert.equal(result, 'abandoned');
  assert.equal(bridge.pendingCount, 0);
  resolve({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
});

test('cancelling the turn releases a pending decision instead of approving it', async () => {
  const client = new StubClient();
  const bridge = build(client);
  const session = new ClaudeProcess(randomUUID(), { ...childOptions, onCanUseTool: (id, request) => bridge.handle(id, request), onCancelPermission: id => bridge.cancel(id) });
  try {
    await session.start(tmpdir());
    const turn = session.prompt([{ type: 'text', text: 'permission' }]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(bridge.pendingCount, 1);
    await session.cancel();
    assert.equal((await turn).cancelled, true);
    assert.equal(bridge.pendingCount, 0);
  } finally { session.close(); bridge.close(); }
});

test('a clarifying question round-trips over the child control channel', async () => {
  const { result } = await runChild('question:single', new StubClient({ elicitation: () => ({ action: 'accept', content: { question_0: 'prettier' } }) }));
  const delivered = JSON.parse(result) as { response: ClaudePermissionResult };
  assert.equal(delivered.response.behavior, 'allow');
  assert.deepEqual(delivered.response.behavior === 'allow' ? (delivered.response.updatedInput as { answers: unknown }).answers : undefined, { 'Which formatter?': 'prettier' });
});

test('the child is launched with the stdio permission tool and no MCP configuration flags', async () => {
  let init: Record<string, any> | undefined;
  const session = new ClaudeProcess(randomUUID(), { ...childOptions, onEvent: event => { if (event.type === 'system') init = event; } });
  try {
    await session.start(tmpdir());
    await session.prompt([{ type: 'text', text: 'flags' }]);
  } finally { session.close(); }
  const args: string[] = init!.args;
  assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'stdio');
  for (const forbidden of ['--mcp-config', '--strict-mcp-config']) assert.ok(!args.includes(forbidden), forbidden);
});

test('an unexpected control request is still refused without granting anything', async () => {
  const session = new ClaudeProcess(randomUUID(), childOptions);
  try {
    await session.start(tmpdir());
    assert.equal((await session.prompt([{ type: 'text', text: 'unsupported-control' }])).result, 'unsupported');
  } finally { session.close(); }
});

test('the standalone executable relays a decision and shuts down with nothing pending', async () => {
  const { spawn } = await import('node:child_process');
  const { Readable, Writable } = await import('node:stream');
  const { writeFile, chmod, mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } = await import('@agentclientprotocol/sdk');
  const cwd = await mkdtemp(join(tmpdir(), 'claude-acp-permission-'));
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(join(cwd, 'claude'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);
  await chmod(join(cwd, 'claude'), 0o755);
  const cli = cliCommand(['--config-dir', join(cwd, 'claude-config')]);
  const child = spawn(cli.command, cli.args, { env: { ...process.env, PATH: `${cwd}:${process.env.PATH}` }, stdio: 'pipe' });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  const client = new ClientSideConnection(() => ({
    sessionUpdate: async () => {},
    requestPermission: async (params) => ({ outcome: { outcome: 'selected' as const, optionId: params.options.find(option => option.kind === 'allow_always')!.optionId } }),
    createElicitation: async () => ({ action: 'accept' as const, content: { question_0: 'dprint' } }),
  }), ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  try {
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { elicitation: { form: {} } } });
    const { sessionId } = await client.newSession({ cwd, mcpServers: [] });
    assert.equal((await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'permission' }] })).stopReason, 'end_turn');
    assert.equal((await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'question:single' }] })).stopReason, 'end_turn');
    assert.equal(diagnostics, '');
  } finally {
    child.stdin.end();
    await new Promise<void>(resolve => child.once('exit', () => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the turn clock stops while a permission waits on a person and restarts in full once it settles', async () => {
  let release!: () => void;
  const session = new ClaudeProcess(randomUUID(), {
    ...childOptions,
    turnTimeoutMs: 200,
    onCanUseTool: () => new Promise<ClaudePermissionResult>(resolve => { release = () => resolve({ behavior: 'deny', message: 'no', decisionClassification: 'user_reject' }); }),
  });
  try {
    await session.start(tmpdir());
    const turn = session.prompt([{ type: 'text', text: 'permission' }]);
    await new Promise(resolve => setTimeout(resolve, 500));
    release();
    assert.equal(JSON.parse((await turn).result as string).scenario, 'permission', 'a 500 ms wait on a person outlasted the 200 ms clock');
    await assert.rejects(session.prompt([{ type: 'text', text: 'wait' }]), /Claude turn timed out/);
  } finally { session.close(); }
});
