import type {
  ClientCapabilities,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { describeToolCall } from './translator';

/** The only _meta namespace the shim and its client read; clients import it rather than repeat the value. */
export const DECISION_META_KEY = 'clanker-corner';

export const CLAUDE_PERMISSION_TOOL = 'stdio';
export const ASK_USER_QUESTION = 'AskUserQuestion';

const DENY_CANCELLED = 'The caller cancelled this request before answering, so nothing ran.';
const DENY_CLOSED = 'The ACP session closed before the caller answered, so nothing ran.';
const DENY_UNANSWERABLE = 'No caller could answer this request, so nothing ran.';
const DENY_DECLINED = 'The caller declined to answer these questions.';

export interface ClaudeRule { toolName: string; ruleContent?: string }
/** Echoed back to the CLI byte-for-byte; the shim never edits a rule or its destination. */
export interface ClaudePermissionUpdate {
  type: string;
  destination?: string;
  behavior?: string;
  rules?: ClaudeRule[];
  directories?: string[];
  [key: string]: unknown;
}

export interface CanUseToolRequest {
  tool_name?: unknown;
  display_name?: unknown;
  input?: unknown;
  description?: unknown;
  permission_suggestions?: unknown;
  blocked_path?: unknown;
  decision_reason?: unknown;
  decision_reason_type?: unknown;
  tool_use_id?: unknown;
  agent_id?: unknown;
  suppress_always_allow_rule?: unknown;
  default_to_no?: unknown;
  requires_user_interaction?: unknown;
}

export type ClaudePermissionResult =
  | {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;
      updatedPermissions?: ClaudePermissionUpdate[];
      toolUseID?: string;
      decisionClassification: 'user_temporary' | 'user_permanent';
    }
  | { behavior: 'deny'; message: string; toolUseID?: string; decisionClassification: 'user_reject' };

export interface PermissionRequestOptions { cancellationSignal?: AbortSignal }
/** Narrow view of AgentSideConnection so tests can drive the bridge without a wire. */
export interface PermissionClient {
  requestPermission(params: RequestPermissionRequest, options?: PermissionRequestOptions): Promise<RequestPermissionResponse>;
  createElicitation(params: CreateElicitationRequest, options?: PermissionRequestOptions): Promise<CreateElicitationResponse>;
}

export interface PermissionBridgeOptions {
  sessionId: string;
  cwd: string;
  client: PermissionClient;
  clientCapabilities?: ClientCapabilities | null;
}

interface Question { question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect: boolean }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

const SCOPES: Record<string, string> = {
  session: 'this session only',
  cliArg: 'this run only',
  localSettings: 'this checkout, privately',
  projectSettings: 'this checkout, shared',
  userSettings: 'every project',
};

function describeRules(rules: ClaudeRule[]): string {
  return rules.map(rule => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName)).join(', ');
}

/** Only a suggestion Claude actually supplied becomes an always option, and its destination is never rewritten. */
function offeredRules(request: CanUseToolRequest): ClaudePermissionUpdate[] {
  if (request.suppress_always_allow_rule === true) return [];
  if (!Array.isArray(request.permission_suggestions)) return [];
  return request.permission_suggestions.filter((suggestion): suggestion is ClaudePermissionUpdate => {
    if (!isPlainObject(suggestion) || typeof suggestion.destination !== 'string') return false;
    // A deny result carries no updatedPermissions, so a remembered denial could not be honoured if offered.
    if (suggestion.type === 'addRules') return suggestion.behavior === 'allow' && Array.isArray(suggestion.rules) && suggestion.rules.length > 0;
    return suggestion.type === 'addDirectories' && Array.isArray(suggestion.directories) && suggestion.directories.length > 0;
  });
}

function ruleLabel(suggestion: ClaudePermissionUpdate): string {
  const scope = SCOPES[suggestion.destination!] ?? suggestion.destination!;
  const subject = suggestion.type === 'addDirectories'
    ? `access to ${suggestion.directories!.join(', ')}`
    : describeRules(suggestion.rules!);
  return `Always allow ${subject} (${scope})`;
}

function questions(input: Record<string, unknown>): Question[] | undefined {
  if (!Array.isArray(input.questions) || !input.questions.length) return undefined;
  const parsed: Question[] = [];
  for (const raw of input.questions) {
    if (!isPlainObject(raw) || typeof raw.question !== 'string' || !Array.isArray(raw.options)) return undefined;
    const options = raw.options.filter(isPlainObject).filter(option => typeof option.label === 'string');
    if (options.length !== raw.options.length) return undefined;
    parsed.push({
      question: raw.question,
      header: text(raw.header),
      options: options.map(option => ({ label: option.label as string, description: text(option.description) })),
      multiSelect: raw.multiSelect === true,
    });
  }
  return parsed;
}

export class ClaudePermissionBridge {
  private inFlight = new Map<string, AbortController>();
  private closed = false;
  constructor(private options: PermissionBridgeOptions) {}

  get pendingCount() { return this.inFlight.size; }

  async handle(requestId: string, request: CanUseToolRequest): Promise<ClaudePermissionResult> {
    const toolUseID = text(request.tool_use_id);
    const deny = (message: string): ClaudePermissionResult => ({ behavior: 'deny', message, ...(toolUseID ? { toolUseID } : {}), decisionClassification: 'user_reject' });
    if (this.closed) return deny(DENY_CLOSED);
    const name = text(request.tool_name);
    if (!name || !isPlainObject(request.input)) return deny('The permission request from Claude was malformed, so nothing ran.');

    const abort = new AbortController();
    // A second request reusing a live id would leave the first unanswerable.
    if (this.inFlight.has(requestId)) return deny('A permission request with this identity is already pending, so nothing ran.');
    this.inFlight.set(requestId, abort);
    try {
      const answered = name === ASK_USER_QUESTION
        ? await this.askQuestions(request, request.input, abort.signal, deny)
        : await this.askPermission(requestId, request, name, request.input, abort.signal, deny);
      return this.inFlight.get(requestId) === abort ? answered : deny(DENY_CANCELLED);
    } catch (error) {
      if (abort.signal.aborted) return deny(this.closed ? DENY_CLOSED : DENY_CANCELLED);
      return deny(`The caller could not be asked (${error instanceof Error ? error.message : 'unknown error'}), so nothing ran.`);
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  /** Resolves the waiting decision as a denial; the CLI has already abandoned this request id. */
  cancel(requestId: string) { this.inFlight.get(requestId)?.abort(); this.inFlight.delete(requestId); }

  close() {
    this.closed = true;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  private async askPermission(
    requestId: string,
    request: CanUseToolRequest,
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    deny: (message: string) => ClaudePermissionResult,
  ): Promise<ClaudePermissionResult> {
    const suggestions = offeredRules(request);
    const options: PermissionOption[] = [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }];
    suggestions.forEach((suggestion, index) => options.push({ optionId: `allow-always-${index}`, name: ruleLabel(suggestion), kind: 'allow_always' }));
    options.push({ optionId: 'reject-once', name: 'Deny', kind: 'reject_once' });

    const described = describeToolCall(text(request.display_name) ?? name, input, this.options.cwd);
    const reason = text(request.description) ?? text(request.decision_reason);
    const blocked = text(request.blocked_path);
    const notes = [reason, blocked ? `Path outside the session's allowed directories: ${blocked}` : undefined].filter(Boolean) as string[];

    const response = await this.race(signal, this.options.client.requestPermission({
      sessionId: this.options.sessionId,
      toolCall: {
        toolCallId: text(request.tool_use_id) ?? `claude-permission-${requestId}`,
        ...described,
        status: 'pending',
        rawInput: input,
        ...(notes.length ? { content: notes.map(note => ({ type: 'content' as const, content: { type: 'text' as const, text: note } })) } : {}),
      },
      options,
      _meta: { [DECISION_META_KEY]: { acceptsModifiedInput: true, acceptsExplanation: true } },
    }, { cancellationSignal: signal }));

    const outcome = response.outcome;
    if (outcome.outcome !== 'selected') return deny(DENY_CANCELLED);
    const chosen = options.find(option => option.optionId === outcome.optionId);
    if (!chosen) return deny('The caller answered with an option that was never offered, so nothing ran.');

    const meta = isPlainObject(response._meta) ? response._meta[DECISION_META_KEY] : undefined;
    const extension = isPlainObject(meta) ? meta : {};
    const explanation = text(extension.explanation);
    if (chosen.kind === 'reject_once' || chosen.kind === 'reject_always') return deny(explanation ?? 'The caller denied this action.');

    // Dropping a modified input silently would run exactly what the caller refused to approve.
    if (extension.modifiedInput !== undefined && !isPlainObject(extension.modifiedInput)) {
      return deny('The caller supplied a modified input that was not an object, so nothing ran.');
    }
    const updatedInput = (extension.modifiedInput as Record<string, unknown> | undefined) ?? input;
    const remembered = chosen.optionId.startsWith('allow-always-') ? suggestions[Number(chosen.optionId.slice('allow-always-'.length))] : undefined;
    const toolUseID = text(request.tool_use_id);
    return {
      behavior: 'allow',
      updatedInput,
      ...(remembered ? { updatedPermissions: [remembered] } : {}),
      ...(toolUseID ? { toolUseID } : {}),
      decisionClassification: remembered ? 'user_permanent' : 'user_temporary',
    };
  }

  private async askQuestions(
    request: CanUseToolRequest,
    input: Record<string, unknown>,
    signal: AbortSignal,
    deny: (message: string) => ClaudePermissionResult,
  ): Promise<ClaudePermissionResult> {
    const parsed = questions(input);
    if (!parsed) return deny('Claude asked a question the shim could not read, so nothing was answered.');
    // Reducing a multiple-choice question to allow/deny would answer it on the caller's behalf.
    if (!this.options.clientCapabilities?.elicitation?.form) return deny(`${DENY_UNANSWERABLE} This client cannot present clarifying questions.`);

    const properties: Record<string, ElicitationPropertySchema> = {};
    const keys = parsed.map((_, index) => `question_${index}`);
    const freeText: string[] = [];
    parsed.forEach((question, index) => {
      const key = keys[index]!;
      const title = question.header ?? question.question;
      const description = [question.question, ...question.options.filter(option => option.description).map(option => `${option.label}: ${option.description}`)].join('\n');
      if (question.multiSelect) {
        properties[key] = { type: 'array', title, description, items: { type: 'string', enum: question.options.map(option => option.label) } };
        return;
      }
      // Claude's own UI always adds an "Other" free-text choice, so the options are suggestions.
      freeText.push(key);
      properties[key] = { type: 'string', title, description, oneOf: question.options.map(option => ({ const: option.label, title: option.label, ...(option.description ? { description: option.description } : {}) })) };
    });

    const schema: ElicitationSchema = { type: 'object', properties, required: keys };
    const toolCallId = text(request.tool_use_id);
    const response = await this.race(signal, this.options.client.createElicitation({
      mode: 'form',
      sessionId: this.options.sessionId,
      ...(toolCallId ? { toolCallId } : {}),
      message: parsed.length === 1 ? parsed[0]!.question : `Claude has ${parsed.length} questions before continuing.`,
      requestedSchema: schema,
      _meta: { [DECISION_META_KEY]: { freeText } },
    }, { cancellationSignal: signal }));

    if (response.action !== 'accept') return deny(response.action === 'decline' ? DENY_DECLINED : DENY_CANCELLED);
    const content = isPlainObject(response.content) ? response.content : undefined;
    if (!content) return deny('The caller accepted the questions without answering them, so nothing was answered.');

    const answers: Record<string, string> = {};
    for (const [index, question] of parsed.entries()) {
      const value = content[keys[index]!];
      const answer = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : undefined;
      if (answer === undefined || !answer.trim()) return deny(`The caller left "${question.question}" unanswered, so nothing was answered.`);
      answers[question.question] = answer;
    }
    const toolUseID = text(request.tool_use_id);
    return {
      behavior: 'allow',
      updatedInput: { questions: input.questions, answers },
      ...(toolUseID ? { toolUseID } : {}),
      decisionClassification: 'user_temporary',
    };
  }

  /** A peer that never answers must not hold the child's tool call open past cancel or shutdown. */
  private race<T>(signal: AbortSignal, pending: Promise<T>): Promise<T> {
    pending.catch(() => {});
    return Promise.race([pending, new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(new Error('aborted'));
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })]);
  }
}
