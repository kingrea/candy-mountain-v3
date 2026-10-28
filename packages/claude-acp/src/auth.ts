import { chmod, lstat, mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const CLAUDE_AUTHENTICATION_ERROR =
  'Claude subscription authentication is unavailable for this config directory. Export it as CLAUDE_CONFIG_DIR and run "claude auth login", or supply a CLAUDE_CODE_OAUTH_TOKEN produced by "claude setup-token". Confirm with "claude auth status --json".';

export const CLAUDE_PROVIDER_ERROR =
  'The Claude child resolved a non-subscription API provider. Remove Bedrock, Vertex, Foundry and base-URL overrides from the service environment so the child runs on the owner\'s first-party subscription.';

export const NON_SUBSCRIPTION_AUTH_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const;

/** Lets the ACP layer answer with the protocol's authentication error instead of a generic internal error. */
export class ClaudeLoginRequiredError extends Error {
  constructor(message: string) { super(message); this.name = 'ClaudeLoginRequiredError'; }
}

export interface PreparedClaudeLaunch {
  configDir: string;
  env: NodeJS.ProcessEnv;
}

export interface ClaudeLaunchEnvironment {
  configDir: string;
  env?: NodeJS.ProcessEnv;
}

/** Prepare a subscription-only stock CLI environment without inspecting credentials. */
export async function prepareClaudeLaunch({ configDir, env = process.env }: ClaudeLaunchEnvironment): Promise<PreparedClaudeLaunch> {
  if (!isAbsolute(configDir)) throw new Error('Claude config directory must be an absolute path');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  // A symlinked home could point the child at another account's login.
  const stats = await lstat(configDir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Claude config directory must be a real directory, not a symbolic link');
  await chmod(configDir, 0o700);

  const childEnv: NodeJS.ProcessEnv = { ...env, CLAUDE_CONFIG_DIR: configDir };
  for (const name of NON_SUBSCRIPTION_AUTH_ENV) delete childEnv[name];

  return { configDir, env: childEnv };
}

/**
 * The initialize control response carries the only account summary the CLI offers before a turn,
 * so it is where a missing login has to be caught rather than at the first prompt.
 */
export function claudeAccountError(initializeResponse: Record<string, unknown>): ClaudeLoginRequiredError | undefined {
  const account = (initializeResponse.response as Record<string, any> | undefined)?.response?.account;
  if (!account || typeof account !== 'object') return undefined;

  if (typeof account.apiProvider === 'string' && account.apiProvider !== 'firstParty') {
    return new ClaudeLoginRequiredError(CLAUDE_PROVIDER_ERROR);
  }
  // CLI 2.1.1 reports any OAuth credential as subscriptionType; 2.1.263 reports an environment
  // token as tokenSource instead, and both report an absent login as tokenSource "none".
  if (account.subscriptionType === undefined && account.tokenSource === 'none') {
    return new ClaudeLoginRequiredError(CLAUDE_AUTHENTICATION_ERROR);
  }
  return undefined;
}

export function claudeAuthenticationError(event: Record<string, unknown>): ClaudeLoginRequiredError | undefined {
  if (event.error === 'authentication_failed') return new ClaudeLoginRequiredError(CLAUDE_AUTHENTICATION_ERROR);

  const details: unknown[] = [event.error, event.result, event.subtype];
  if (Array.isArray(event.errors)) details.push(...event.errors);
  const text = details.filter(value => typeof value === 'string').join(' ');

  if (/not logged in|please run \/login/i.test(text)) return new ClaudeLoginRequiredError(CLAUDE_AUTHENTICATION_ERROR);
  return undefined;
}
