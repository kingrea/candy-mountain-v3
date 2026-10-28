import { randomUUID } from 'node:crypto';
import { CLIENT_METHODS, PROTOCOL_VERSION, type Agent, type ClientCapabilities, type InitializeRequest, type InitializeResponse, type NewSessionRequest, type NewSessionResponse, type LoadSessionRequest, type LoadSessionResponse, type PromptRequest, type PromptResponse, type CancelNotification, type AgentSideConnection, type ContentBlock, RequestError } from '@agentclientprotocol/sdk';
import { ClaudePermissionBridge, type PermissionClient } from './permissions';
import { ClaudeEventTranslator, convertPrompt } from './translator';
import { ClaudeProcess, type ProcessOptions, type ClaudeEvent } from './process';
import { CLAUDE_AUTHENTICATION_ERROR, ClaudeLoginRequiredError } from './auth';

export interface AgentOptions {
  processOptions?: ProcessOptions | ((session: { sessionId: string; cwd: string; resume: boolean }) => ProcessOptions | Promise<ProcessOptions>);
  convertPrompt?: (prompt: ContentBlock[]) => unknown[];
  onEvent?: (event: ClaudeEvent, sessionId: string, connection: AgentSideConnection) => void | Promise<void>;
}
// A bare Error thrown across the ACP wire is otherwise flattened to a generic "Internal error" with no
// message (the SDK only preserves the original text in .data, not .message), which fails the "bounded,
// intelligible failure" bar for an unauthenticated child or an unexpected child exit.
const toRequestError = (error: unknown) => {
  if (error instanceof ClaudeLoginRequiredError) return RequestError.authRequired(undefined, error.message);
  if (error instanceof RequestError) return error;
  return RequestError.internalError(undefined, error instanceof Error ? error.message : String(error));
};

export class ClaudeAcpAgent implements Agent {
  private initialized = false;
  private session?: ClaudeProcess;
  private starting = false;
  private translator?: ClaudeEventTranslator;
  private permissions?: ClaudePermissionBridge;
  private clientCapabilities?: ClientCapabilities | null;
  private prompting = false;
  constructor(private connection: AgentSideConnection, private options: AgentOptions = {}) {}
  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.initialized = true;
    this.clientCapabilities = params.clientCapabilities;
    return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'claude-acp', version: '0.1.0' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } }, authMethods: [] };
  }
  private async start(params: NewSessionRequest, sessionId: string, resume: boolean) {
    if (!this.initialized) throw new Error('Initialize ACP before creating a session');
    if (this.session || this.starting) throw new Error('This executable supports one session per process');
    if (params.mcpServers.length) throw new Error('Client MCP configuration is not supported by this lifecycle adapter yet');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Claude session identity must be a UUID');
    this.starting = true;
    try {
      const config = typeof this.options.processOptions === 'function' ? await this.options.processOptions({ sessionId, cwd: params.cwd, resume }) : this.options.processOptions;
      this.translator = new ClaudeEventTranslator(update => this.connection.sessionUpdate({ sessionId, update }), params.cwd);
      const permissions = new ClaudePermissionBridge({ sessionId, cwd: params.cwd, client: this.permissionClient(), clientCapabilities: this.clientCapabilities });
      this.permissions = permissions;
      const session = new ClaudeProcess(sessionId, { ...config, onEvent: async (event) => {
        await this.translator!.accept(event);
        await config?.onEvent?.(event);
        await this.options.onEvent?.(event, sessionId, this.connection);
      }, onCanUseTool: (requestId, request) => permissions.handle(requestId, request), onCancelPermission: (requestId) => permissions.cancel(requestId) });
      this.session = session;
      await session.start(params.cwd, resume);
    } catch (error) { this.close(); throw toRequestError(error); }
    finally { this.starting = false; }
  }
  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomUUID(); await this.start(params, sessionId, false); return { sessionId };
  }
  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    await this.start(params, params.sessionId, true); return {};
  }
  async authenticate(): Promise<void> { throw RequestError.authRequired(undefined, CLAUDE_AUTHENTICATION_ERROR); }
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.getSession(params.sessionId);
    if (this.prompting) throw new Error('A Claude prompt is already running');
    const content = (this.options.convertPrompt ?? convertPrompt)(params.prompt);
    this.prompting = true; this.translator?.beginTurn();
    try {
      const result = await session.prompt(content);
      return { stopReason: result.cancelled ? 'cancelled' : 'end_turn' };
    } catch (error) { throw toRequestError(error); }
    finally { this.prompting = false; }
  }
  async cancel(params: CancelNotification): Promise<void> { await this.getSession(params.sessionId).cancel(); }
  private getSession(id: string) {
    if (!this.session || this.session.sessionId !== id || this.starting) throw new Error('Unknown or unavailable Claude session');
    return this.session;
  }
  /** The child's own abort resolves its pending tool calls; closing the bridge releases the caller side. */
  close() { this.session?.close(); this.permissions?.close(); }

  private permissionClient(): PermissionClient {
    return {
      requestPermission: (params, options) => this.connection.request(CLIENT_METHODS.session_request_permission, params, { cancellationSignal: options?.cancellationSignal }),
      createElicitation: (params, options) => this.connection.request(CLIENT_METHODS.elicitation_create, params, { cancellationSignal: options?.cancellationSignal }),
    };
  }
}
