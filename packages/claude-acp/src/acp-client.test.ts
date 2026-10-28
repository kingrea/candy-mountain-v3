import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpClient, type AcpClientPolicy } from '../scripts/acp-client';
import { DECISION_META_KEY } from './permissions';

// Drives the real executable over ACP stdio framing to catch boundary defects (framing, argv, env) that in-process tests cannot see.
const fixture = fileURLToPath(new URL('./test-support/claude-fixture.mjs', import.meta.url));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

async function fakeClaudeCheckout(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(cwd, 'claude'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);
  await chmod(join(cwd, 'claude'), 0o755);
  return cwd;
}

function client(cwd: string, options: { policy?: AcpClientPolicy; env?: NodeJS.ProcessEnv } = {}): AcpClient {
  return new AcpClient({
    args: ['--config-dir', join(cwd, 'claude-config')],
    env: { ...process.env, PATH: `${cwd}:${process.env.PATH ?? ''}`, ...options.env },
    policy: options.policy,
  });
}

const denyOnce: AcpClientPolicy = { onPermission: async () => ({ outcome: { outcome: 'cancelled' } }) };

test('stream ordering and tool-call/result association survive the real ACP wire', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-tool-');
  const c = client(cwd);
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    assert.equal((await c.prompt({ sessionId, prompt: [{ type: 'text', text: 'tool-call' }] })).stopReason, 'end_turn');
    const updates = c.updates.map((n) => n.update as Record<string, unknown>);
    const kinds = updates.map((u) => u.sessionUpdate);
    // tool_call must precede its own completion, and the completion must precede the text that follows it in the transcript.
    assert.deepEqual(kinds, ['tool_call', 'tool_call_update', 'tool_call_update', 'agent_message_chunk']);
    assert.ok(updates.slice(0, 3).every((u) => u.toolCallId === 'toolcall1'));
    assert.equal(updates[1]!.rawInput ? JSON.stringify(updates[1]!.rawInput) : undefined, JSON.stringify({ command: 'ls' }));
    assert.equal(updates[2]!.status, 'completed');
    assert.equal((updates[3]!.content as { text: string }).text, 'Done.');
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('a session id round-trips through session/new and session/load to a fresh executable invocation', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-resume-');
  const first = client(cwd);
  first.connect();
  let sessionId: string;
  try {
    await first.initialize();
    sessionId = (await first.newSession({ cwd })).sessionId;
    await first.prompt({ sessionId, prompt: [{ type: 'text', text: 'session-id' }] });
    assert.deepEqual(first.text(), [sessionId]);
  } finally { await first.close(); }

  const second = client(cwd);
  second.connect();
  try {
    await second.initialize();
    await second.loadSession({ cwd, sessionId });
    await second.prompt({ sessionId, prompt: [{ type: 'text', text: 'session-id' }] });
    // A second, independent executable process was resumed with the exact identity the first one returned.
    assert.deepEqual(second.text(), [sessionId]);
  } finally { await second.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('an image block reaches the child unchanged and in prompt order, over the wire', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-image-');
  const c = client(cwd);
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    const prompt = [{ type: 'text' as const, text: 'echo-content' }, { type: 'image' as const, mimeType: 'image/png', data: 'aGVsbG8=' }, { type: 'text' as const, text: 'more context' }];
    await c.prompt({ sessionId, prompt });
    const received = JSON.parse(c.text()[0]!);
    assert.deepEqual(received, [
      { type: 'text', text: 'echo-content' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      { type: 'text', text: 'more context' },
    ]);
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('a subsequent prompt succeeds on the same executable after a cancel', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-cancel-');
  const c = client(cwd);
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    const pending = c.prompt({ sessionId, prompt: [{ type: 'text', text: 'wait' }] });
    await c.cancel({ sessionId });
    assert.equal((await pending).stopReason, 'cancelled');
    const after = await c.prompt({ sessionId, prompt: [{ type: 'text', text: 'again' }] });
    assert.equal(after.stopReason, 'end_turn');
    assert.equal(c.text().at(-1), 'again');
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('permission denial carries the caller explanation back to the requesting tool call', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-deny-');
  const policy: AcpClientPolicy = {
    onPermission: async (request) => {
      const reject = request.options.find((o) => o.kind === 'reject_once')!;
      return { outcome: { outcome: 'selected', optionId: reject.optionId }, _meta: { [DECISION_META_KEY]: { explanation: 'Use the staged diff instead.' } } };
    },
  };
  const c = client(cwd, { policy });
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    await c.prompt({ sessionId, prompt: [{ type: 'text', text: 'permission' }] });
    const delivered = JSON.parse(c.text()[0]!);
    assert.equal(delivered.response.behavior, 'deny');
    assert.equal(delivered.response.message, 'Use the staged diff instead.');
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('a modified input replaces what the tool actually runs', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-modify-');
  const policy: AcpClientPolicy = {
    onPermission: async (request) => {
      const allow = request.options.find((o) => o.kind === 'allow_once')!;
      return { outcome: { outcome: 'selected', optionId: allow.optionId }, _meta: { [DECISION_META_KEY]: { modifiedInput: { file_path: 'notes.md', content: 'redacted' } } } };
    },
  };
  const c = client(cwd, { policy });
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    await c.prompt({ sessionId, prompt: [{ type: 'text', text: 'permission:plain' }] });
    const delivered = JSON.parse(c.text()[0]!);
    assert.equal(delivered.response.behavior, 'allow');
    assert.deepEqual(delivered.response.updatedInput, { file_path: 'notes.md', content: 'redacted' });
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

for (const scenario of ['permission', 'permission:suppressed', 'permission:legacy']) {
  test(`remembered-rule options are offered only when Claude actually supplies suggestions (${scenario})`, async () => {
    const cwd = await fakeClaudeCheckout('claude-acp-exec-remember-');
    let seenKinds: string[] = [];
    const policy: AcpClientPolicy = {
      onPermission: async (request) => {
        seenKinds = request.options.map((o) => o.kind);
        const chosen = request.options.find((o) => o.kind === 'allow_always') ?? request.options.find((o) => o.kind === 'allow_once')!;
        return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
      },
    };
    const c = client(cwd, { policy });
    c.connect();
    try {
      await c.initialize();
      const { sessionId } = await c.newSession({ cwd });
      await c.prompt({ sessionId, prompt: [{ type: 'text', text: scenario }] });
      const delivered = JSON.parse(c.text()[0]!);
      if (scenario === 'permission') {
        // Two suggestions were supplied (localSettings, session): both become allow_always, one per suggestion.
        assert.deepEqual(seenKinds, ['allow_once', 'allow_always', 'allow_always', 'reject_once']);
        assert.equal(delivered.response.behavior, 'allow');
        assert.ok(Array.isArray(delivered.response.updatedPermissions) && delivered.response.updatedPermissions.length === 1);
      } else {
        // suppressed: suggestion present but suppress_always_allow_rule set. legacy: no suggestion at all. Neither offers allow_always.
        assert.deepEqual(seenKinds, ['allow_once', 'reject_once']);
        assert.equal(delivered.response.updatedPermissions, undefined);
      }
    } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
  });
}

test('clarifying question options and a free-text answer round-trip through the elicitation channel', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-question-');
  let seenSchema: unknown;
  const policy: AcpClientPolicy = {
    onElicitation: async (request) => {
      assert.equal(request.mode, 'form');
      seenSchema = request.mode === 'form' ? request.requestedSchema : undefined;
      // "biome, actually" is not one of the offered formatter labels: proves free text is accepted, not just the closed option set.
      return { action: 'accept', content: { question_0: 'biome, actually', question_1: ['web', 'node'] } };
    },
  };
  const c = client(cwd, { policy });
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    await c.prompt({ sessionId, prompt: [{ type: 'text', text: 'question' }] });
    const schema = seenSchema as { properties: Record<string, any> };
    assert.deepEqual(schema.properties.question_0.oneOf.map((o: { const: string }) => o.const), ['prettier', 'dprint']);
    assert.deepEqual(schema.properties.question_1.items.enum, ['web', 'node']);
    const delivered = JSON.parse(c.text()[0]!);
    assert.equal(delivered.response.behavior, 'allow');
    assert.deepEqual(delivered.response.updatedInput.answers, { 'Which formatter?': 'biome, actually', 'Which targets?': 'web, node' });
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('unauthenticated child startup fails session creation with a bounded, intelligible error and asks no permission', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-unauth-');
  let permissionRequests = 0;
  const policy: AcpClientPolicy = { onPermission: async () => { permissionRequests += 1; return { outcome: { outcome: 'cancelled' } }; } };
  const c = client(cwd, { policy, env: { FIXTURE_ACCOUNT: 'none' } });
  c.connect();
  try {
    await c.initialize();
    await assert.rejects(c.newSession({ cwd }), (error: unknown) => {
      const message = String((error as { message?: string }).message ?? error);
      return message.includes('Authentication required') && message.includes('claude auth login');
    });
    assert.equal(permissionRequests, 0);
    assert.equal(c.diagnostics, '');
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});

test('an unexpected child exit mid-turn fails the prompt promptly instead of hanging', async () => {
  const cwd = await fakeClaudeCheckout('claude-acp-exec-crash-');
  const c = client(cwd, { policy: denyOnce });
  c.connect();
  try {
    await c.initialize();
    const { sessionId } = await c.newSession({ cwd });
    const started = Date.now();
    // Whichever of the child's 'exit' or stdout 'end' handlers fires first decides the exact wording; both describe the same abnormal termination.
    await assert.rejects(c.prompt({ sessionId, prompt: [{ type: 'text', text: 'crash' }] }), /exited|stream closed/);
    assert.ok(Date.now() - started < 5000, 'the rejection must be bounded, not dependent on any turn timeout');
  } finally { await c.close(); await rm(cwd, { recursive: true, force: true }); }
});
