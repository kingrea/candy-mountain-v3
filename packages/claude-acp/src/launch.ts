import { resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream, type Stream } from '@agentclientprotocol/sdk';
import { ClaudeAcpAgent, type AgentOptions } from './agent';
import { prepareClaudeLaunch } from './auth';

export interface ClaudeLaunchOptions {
  /** Absolute path passed to the child as CLAUDE_CONFIG_DIR; this is the login the session runs on. */
  configDir: string;
  /** Posture flags forwarded verbatim to the stock CLI, after the shim's own stream-json flags. */
  claudeArgs?: string[];
  command?: string;
  /** Base environment for the child before API-key and provider variables are stripped; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  turnTimeoutMs?: number;
  onDiagnostic?: (text: string) => void;
}

export function createAgent(connection: AgentSideConnection, options: ClaudeLaunchOptions, agentOptions: Omit<AgentOptions, 'processOptions'> = {}): ClaudeAcpAgent {
  return new ClaudeAcpAgent(connection, {
    ...agentOptions,
    processOptions: async () => {
      const launch = await prepareClaudeLaunch({ configDir: options.configDir, env: options.env });
      return {
        ...(options.command ? { command: options.command } : {}),
        env: launch.env,
        additionalArgs: options.claudeArgs ?? [],
        turnTimeoutMs: options.turnTimeoutMs,
        onDiagnostic: options.onDiagnostic,
      };
    },
  });
}

export interface LaunchedAgent {
  connection: AgentSideConnection;
  /** Kills the Claude child and releases any pending decisions; the connection closes when its stream ends. */
  close(): void;
}

/** Serves one ACP session over `stream`, or over this process's stdio when omitted. */
export function launch(options: ClaudeLaunchOptions & { stream?: Stream }): LaunchedAgent {
  const stream = options.stream ?? ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
  const onDiagnostic = options.onDiagnostic ?? (options.stream ? undefined : (text: string) => { process.stderr.write(text); });
  let agent: ClaudeAcpAgent | undefined;
  const connection = new AgentSideConnection((conn) => (agent = createAgent(conn, { ...options, onDiagnostic })), stream);
  const close = () => agent?.close();
  connection.closed.then(close, close);
  return { connection, close };
}

export const LAUNCH_USAGE = `Usage: candy-mountain-claude-acp --config-dir <dir> [--claude <path>] [--turn-timeout-ms <ms>] [-- <claude flags>...]

Serves one ACP session over stdio, driving the stock claude CLI.
  --config-dir <dir>       CLAUDE_CONFIG_DIR for the child (created 0700 if missing)
  --claude <path>          claude executable (default: claude on PATH)
  --turn-timeout-ms <ms>   cut a turn that runs longer than this (default 600000)
  -- <claude flags>        forwarded verbatim to claude, e.g. --permission-mode plan`;

export class LaunchUsageError extends Error {
  constructor(message: string) { super(message); this.name = 'LaunchUsageError'; }
}

export function parseLaunchArgs(argv: string[], cwd = process.cwd()): ClaudeLaunchOptions {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const claudeArgs = separator === -1 ? [] : argv.slice(separator + 1);
  const options: Partial<ClaudeLaunchOptions> = { claudeArgs };
  for (let index = 0; index < own.length; index++) {
    const name = own[index]!;
    const value = own[index + 1];
    if (!['--config-dir', '--claude', '--turn-timeout-ms'].includes(name)) throw new LaunchUsageError(`Unknown argument: ${name}`);
    if (value === undefined || value.startsWith('--')) throw new LaunchUsageError(`${name} needs a value`);
    index++;
    if (name === '--config-dir') options.configDir = resolve(cwd, value);
    else if (name === '--claude') options.command = value;
    else {
      const timeout = Number(value);
      if (!Number.isInteger(timeout) || timeout <= 0) throw new LaunchUsageError('--turn-timeout-ms must be a positive integer');
      options.turnTimeoutMs = timeout;
    }
  }
  if (!options.configDir) throw new LaunchUsageError('--config-dir is required');
  return options as ClaudeLaunchOptions;
}
