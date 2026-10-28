import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { claudeAccountError, claudeAuthenticationError } from './auth';
import { CLAUDE_PERMISSION_TOOL, type CanUseToolRequest, type ClaudePermissionResult } from './permissions';

export type ClaudeEvent = Record<string, any>;
export interface ProcessOptions {
  command?: string;
  /** For controlled child fixtures. Production uses the stock claude executable. */
  commandPrefix?: string[];
  env?: NodeJS.ProcessEnv;
  additionalArgs?: string[];
  startupTimeoutMs?: number;
  turnTimeoutMs?: number;
  cancelTimeoutMs?: number;
  onEvent?: (event: ClaudeEvent) => void | Promise<void>;
  onDiagnostic?: (text: string) => void;
  onCanUseTool?: (requestId: string, request: CanUseToolRequest) => Promise<ClaudePermissionResult>;
  onCancelPermission?: (requestId: string) => void;
}
const STARTUP_STDERR_LIMIT = 1000;
type Pending = { resolve: (event: ClaudeEvent) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
export class ClaudeProcess {
  private child?: ChildProcessWithoutNullStreams;
  private failure?: Error;
  private pending?: Pending;
  private controls = new Map<string, Pending>();
  private permissions = new Set<string>();
  private buffer = '';
  /** A CLI that refuses to start (a sandbox it cannot run, say) says why only on stderr. */
  private startupStderr: string | undefined = '';
  private queue = Promise.resolve();
  private cancelled = false;
  constructor(readonly sessionId: string, private options: ProcessOptions = {}) {}
  get running() { return !!this.child && !this.failure; }
  async start(cwd: string, resume = false): Promise<void> {
    if (this.child) throw new Error('Claude child already started');
    if (!isAbsolute(cwd)) throw new Error('Checkout must be an absolute path');
    const args = [...(this.options.commandPrefix ?? []), '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--permission-prompt-tool', CLAUDE_PERMISSION_TOOL, resume ? '--resume' : '--session-id', this.sessionId, ...(this.options.additionalArgs ?? [])];
    this.child = spawn(this.options.command ?? 'claude', args, { cwd, env: this.options.env ?? process.env, stdio: 'pipe' });
    this.child.stdin.on('error', () => this.fail(new Error('Claude input stream failed')));
    this.child.on('error', (error) => this.fail(new Error(`Unable to start stock Claude CLI: ${error.message}`)));
    this.child.on('exit', (code, signal) => { void this.queue.then(() => this.fail(new Error(`Claude child exited (code ${code}, signal ${signal})`))); });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.read(chunk));
    this.child.stdout.on('end', () => { void this.queue.then(() => this.fail(new Error(this.buffer.trim() ? 'Truncated Claude stream-json output' : 'Claude output stream closed'))); });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (text: string) => {
      if (this.startupStderr !== undefined) this.startupStderr = (this.startupStderr + text).slice(-STARTUP_STDERR_LIMIT);
      this.options.onDiagnostic?.(text);
    });
    try {
      const initialized = await this.control('initialize', this.options.startupTimeoutMs ?? 30_000);
      this.startupStderr = undefined;
      const accountError = claudeAccountError(initialized);
      if (accountError) throw accountError;
    }
    catch (error) {
      const gone = this.child.exitCode !== null || this.child.signalCode !== null || this.child.stdout.readableEnded;
      this.fail(error as Error);
      throw gone ? await this.withStartupReason(error as Error) : error;
    }
  }
  private async withStartupReason(error: Error): Promise<Error> {
    const stderr = this.child!.stderr;
    // Its stdout can close before the last of its stderr arrives.
    if (!stderr.closed) await new Promise<void>(resolve => { stderr.once('close', resolve); setTimeout(resolve, 200).unref(); });
    const reason = this.startupStderr?.trim();
    return reason ? new Error(`${error.message}: ${reason}`) : error;
  }
  private read(chunk: string) {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      if (line.length > 8 * 1024 * 1024) return this.fail(new Error('Claude stream-json record exceeds limit'));
      let event: ClaudeEvent;
      try { event = JSON.parse(line); if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new Error(); }
      catch { this.fail(new Error('Malformed Claude stream-json output')); return; }
      this.queue = this.queue.then(() => this.receive(event)).catch((error) => this.fail(error instanceof Error ? error : new Error('Claude event handling failed')));
    }
    if (this.buffer.length > 8 * 1024 * 1024) this.fail(new Error('Claude stream-json record exceeds limit'));
  }
  private async receive(event: ClaudeEvent) {
    if (this.failure) return;
    const authenticationError = claudeAuthenticationError(event);
    if (authenticationError) { this.fail(authenticationError); return; }
    if (event.type === 'control_response') {
      const response = event.response;
      const pending = this.controls.get(response?.request_id);
      if (pending) {
        if (response.subtype !== 'error' && response.subtype !== 'success') { this.fail(new Error('Malformed Claude control response')); return; }
        clearTimeout(pending.timer); this.controls.delete(response.request_id);
        if (response.subtype === 'error') pending.reject(new Error(`Claude control request failed: ${response.error ?? 'unknown error'}`));
        else if (response.subtype === 'success') pending.resolve(event);
        else this.fail(new Error('Malformed Claude control response'));
      }
      return;
    }
    if (event.type === 'control_cancel_request') { this.abandon(String(event.request_id ?? '')); return; }
    // Never implicitly approve an unexpected CLI permission/control request.
    if (event.type === 'control_request') {
      const requestId = String(event.request_id ?? '');
      if (requestId && event.request?.subtype === 'can_use_tool') { this.decide(requestId, event.request as CanUseToolRequest); return; }
      this.write({ type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'Unsupported control request; no approval granted' } });
      return;
    }
    if ((event.type === 'result' && event.is_error && !this.pending) || (event.type === 'auth_status' && event.error)) {
      this.fail(new Error(`Claude startup failed: ${event.error ?? event.errors?.join('; ') ?? event.result ?? event.subtype}`)); return;
    }
    await this.options.onEvent?.(event.type === 'result' ? { ...event, cancelled: this.cancelled } : event);
    if (event.type === 'result' && this.pending) {
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer);
      if (!this.cancelled && !event.is_error && event.subtype !== 'success' && !(typeof event.subtype === 'string' && event.subtype.startsWith('error_'))) pending.reject(new Error(`Unsupported Claude result subtype: ${event.subtype}`));
      else if ((event.is_error || event.subtype !== 'success') && !this.cancelled) pending.reject(new Error(`Claude turn failed: ${Array.isArray(event.errors) ? event.errors.join('; ') : event.result ?? event.subtype}`));
      else pending.resolve({ ...event, cancelled: this.cancelled });
    }
  }
  /** Detached from the event queue: a human decision must not stall the child's output stream. */
  private decide(requestId: string, request: CanUseToolRequest) {
    this.permissions.add(requestId);
    if (this.pending && !this.cancelled) clearTimeout(this.pending.timer);
    const settle = (result: ClaudePermissionResult) => {
      if (!this.permissions.delete(requestId) || this.failure) return;
      this.resumeTurnClock();
      try { this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: result } }); }
      catch { /* the write failure already terminated the child */ }
    };
    const handler = this.options.onCanUseTool;
    if (!handler) return settle({ behavior: 'deny', message: 'No caller is attached to answer permission requests, so nothing ran.', decisionClassification: 'user_reject' });
    handler(requestId, request).then(settle, (error: unknown) => settle({ behavior: 'deny', message: `The permission relay failed (${error instanceof Error ? error.message : 'unknown error'}), so nothing ran.`, decisionClassification: 'user_reject' }));
  }

  private abandon(requestId: string) {
    if (!requestId || !this.permissions.delete(requestId)) return;
    this.options.onCancelPermission?.(requestId);
    this.resumeTurnClock();
  }

  private write(value: unknown) {
    if (this.failure) throw this.failure;
    if (!this.child) throw new Error('Claude child is not started');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  private control(subtype: string, timeout: number): Promise<ClaudeEvent> {
    const request_id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Claude ${subtype} timed out`)), timeout);
      this.controls.set(request_id, { resolve, reject, timer });
      try { this.write({ type: 'control_request', request_id, request: { subtype } }); }
      catch (error) { this.fail(error as Error); }
    });
  }
  prompt(content: unknown[]): Promise<ClaudeEvent> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error('A Claude prompt is already running'));
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: this.turnTimer() };
      try { this.write({ type: 'user', session_id: this.sessionId, message: { role: 'user', content }, parent_tool_use_id: null }); }
      catch (error) { this.fail(error as Error); }
    });
  }
  private turnTimer() {
    return setTimeout(() => this.fail(new Error('Claude turn timed out')), this.options.turnTimeoutMs ?? 600_000);
  }
  // A turn waiting on a human is not hung: the clock stops while a permission is open and restarts in full once the last one settles.
  private resumeTurnClock() {
    if (!this.pending || this.cancelled || this.permissions.size > 0) return;
    clearTimeout(this.pending.timer);
    this.pending.timer = this.turnTimer();
  }
  async cancel(): Promise<void> {
    if (!this.pending) return;
    this.cancelled = true;
    // A successful interrupt acknowledges receipt; wait for result before accepting another prompt.
    clearTimeout(this.pending.timer);
    this.pending.timer = setTimeout(() => this.fail(new Error('Claude cancellation timed out')), this.options.cancelTimeoutMs ?? 10_000);
    await this.control('interrupt', this.options.cancelTimeoutMs ?? 10_000);
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    for (const pending of this.controls.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.controls.clear();
    for (const requestId of [...this.permissions]) this.abandon(requestId);
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      const child = this.child;
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
  }
  close() { this.fail(new Error('Claude session closed')); }
}
