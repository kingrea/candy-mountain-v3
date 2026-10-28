import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type SessionNotification } from '@agentclientprotocol/sdk';
import { afterEach, test } from 'vitest';
import { AcpClient } from '../scripts/acp-client';
import { NON_SUBSCRIPTION_AUTH_ENV, prepareClaudeLaunch } from './auth';
import { launch, LaunchUsageError, parseLaunchArgs } from './launch';

const fixture = fileURLToPath(new URL('./test-support/claude-fixture.mjs', import.meta.url));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fakeClaude(prefix: string): Promise<{ dir: string; claude: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  const claude = join(dir, 'claude');
  await writeFile(claude, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`);
  await chmod(claude, 0o755);
  return { dir, claude };
}

const textOf = (updates: SessionNotification[]) => updates.flatMap(({ update }) => update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []);

test('launch arguments: config dir, claude path, turn timeout and forwarded posture flags', () => {
  assert.deepEqual(parseLaunchArgs(['--config-dir', '/homes/p1', '--claude', '/bin/claude', '--turn-timeout-ms', '5000', '--', '--permission-mode', 'plan', '--allowedTools', 'Bash(bd *)']), {
    configDir: '/homes/p1', command: '/bin/claude', turnTimeoutMs: 5000, claudeArgs: ['--permission-mode', 'plan', '--allowedTools', 'Bash(bd *)'],
  });
  assert.deepEqual(parseLaunchArgs(['--config-dir', 'relative'], '/work'), { configDir: '/work/relative', claudeArgs: [] });
  for (const argv of [[], ['--config-dir'], ['--config-dir', '/x', '--permission-mode', 'plan'], ['--config-dir', '/x', '--turn-timeout-ms', '0'], ['--config-dir', '--claude', '/bin/claude']]) {
    assert.throws(() => parseLaunchArgs(argv), LaunchUsageError, JSON.stringify(argv));
  }
});

test('the config directory is created owner-only and a symlinked one is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-acp-config-'));
  cleanup.push(root);
  const configDir = join(root, 'nested', 'claude');
  await prepareClaudeLaunch({ configDir, env: {} });
  assert.equal((await stat(configDir)).mode & 0o777, 0o700);
  await mkdir(join(root, 'elsewhere'));
  await symlink(join(root, 'elsewhere'), join(root, 'linked'));
  await assert.rejects(prepareClaudeLaunch({ configDir: join(root, 'linked'), env: {} }), /symbolic link/);
  await assert.rejects(prepareClaudeLaunch({ configDir: 'relative', env: {} }), /absolute/);
});

test('the executable strips API keys from the child, keeps the subscription token and forwards posture flags', async () => {
  const { dir } = await fakeClaude('claude-acp-launch-env-');
  const configDir = join(dir, 'claude-config');
  const parentEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, CLAUDE_CONFIG_DIR: '/shared/default', CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-oauth-token' };
  for (const name of NON_SUBSCRIPTION_AUTH_ENV) parentEnv[name] = `synthetic-${name}`;
  const client = new AcpClient({ args: ['--config-dir', configDir, '--', '--permission-mode', 'plan'], env: parentEnv });
  client.connect();
  try {
    await client.initialize();
    const { sessionId } = await client.newSession({ cwd: dir });
    await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'launch-env' }] });
    const seen = JSON.parse(client.text()[0]!) as { args: string[]; configDir: string; oauthToken: string; authEnv: string[] };
    assert.equal(seen.configDir, configDir);
    assert.equal(seen.oauthToken, 'synthetic-oauth-token');
    assert.deepEqual(seen.authEnv.filter(name => (NON_SUBSCRIPTION_AUTH_ENV as readonly string[]).includes(name)), []);
    assert.deepEqual(seen.args.slice(-2), ['--permission-mode', 'plan']);
    assert.equal(seen.args[seen.args.indexOf('--session-id') + 1], sessionId);
  } finally { await client.close(); }
});

test('launch serves a session over in-process streams for a library caller', async () => {
  const { dir, claude } = await fakeClaude('claude-acp-launch-lib-');
  const toAgent = new TransformStream<Uint8Array, Uint8Array>();
  const toClient = new TransformStream<Uint8Array, Uint8Array>();
  const agent = launch({ configDir: join(dir, 'claude-config'), command: claude, claudeArgs: ['--agent', 'reviewer'], env: { PATH: process.env.PATH }, stream: ndJsonStream(toClient.writable, toAgent.readable) });
  const updates: SessionNotification[] = [];
  const client = new ClientSideConnection(() => ({
    sessionUpdate: async (params) => { updates.push(params); },
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  }), ndJsonStream(toAgent.writable, toClient.readable));
  try {
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const { sessionId } = await client.newSession({ cwd: dir, mcpServers: [] });
    assert.equal((await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'launch-env' }] })).stopReason, 'end_turn');
    const seen = JSON.parse(textOf(updates)[0]!) as { args: string[] };
    assert.deepEqual(seen.args.slice(-2), ['--agent', 'reviewer']);
  } finally { agent.close(); }
});
