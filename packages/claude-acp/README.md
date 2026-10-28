# @candy-mountain/claude-acp

A stdio ACP agent that drives the stock `claude` CLI, lifted from Clanker Corner's
`packages/claude-acp`. One process serves one ACP session and runs one `claude`
child. It never logs in, reads credential files, installs Claude, or talks to
Anthropic itself; the child runs on whatever login lives in the config directory
it is given.

## Launch arguments

```
candy-mountain-claude-acp --config-dir <dir> [--claude <path>] [--turn-timeout-ms <ms>] [-- <claude flags>...]
```

| Argument | Meaning |
| --- | --- |
| `--config-dir <dir>` | Required. Passed to the child as `CLAUDE_CONFIG_DIR`, replacing any inherited value. Created `0700` if missing, chmodded to `0700` if present, refused if it is a symlink. Relative paths resolve against the shim's cwd. |
| `--claude <path>` | The `claude` executable. Defaults to `claude` on `PATH`. |
| `--turn-timeout-ms <ms>` | Fails a turn that runs longer than this (default 600000). The clock pauses while a permission request waits on a person. |
| `-- <flags>` | Posture flags, forwarded verbatim to `claude` after the shim's own flags: `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--settings`, `--append-system-prompt`, `--agent`, and so on. The shim does not inspect or vet them; the caller owns posture. |

Bad arguments exit `2` with usage on stderr. stdout carries only ACP framing;
the child's stderr is copied to the shim's stderr.

The child always gets `--print --verbose --input-format stream-json
--output-format stream-json --include-partial-messages --permission-prompt-tool
stdio` plus `--session-id <uuid>` (`session/new`) or `--resume <uuid>`
(`session/load`), in the session's `cwd`, which must be absolute.

## Environment stripping

The child inherits the shim's environment with `CLAUDE_CONFIG_DIR` set to
`--config-dir` and these removed, because Claude prefers API keys and cloud
providers over a subscription login:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`
- `CLAUDE_CODE_OAUTH_SCOPES`
- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`

`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) passes through untouched,
so a long-lived subscription token works as an alternative to a stored login.
Anything else, such as `ANTHROPIC_BASE_URL`, is not stripped; the startup check
below rejects a child that resolves a non-first-party provider instead.

## Login and auth errors

The `initialize` control response carries the child's account summary. When it
shows no login (`tokenSource: "none"` without `subscriptionType`), or a provider
other than `firstParty`, `session/new` and `session/load` fail with the ACP
`Authentication required` error (`-32000`) and no turn starts. A login that
expires mid-turn fails that prompt with the same error. Check a config directory
by hand with `CLAUDE_CONFIG_DIR=<dir> claude auth status --json`.

## Protocol behaviour

- `initialize` advertises `loadSession` and image prompts, and no auth methods.
- One session per process; client-supplied MCP servers are rejected.
- `session/cancel` sends the CLI an `interrupt` and the prompt resolves `cancelled`.
- Permission requests become `session/request_permission` with Allow once, one
  Always allow per rule the CLI itself suggested, and Deny. Anything other than
  an explicit allow is a denial. The caller may return `modifiedInput` or an
  `explanation` under `_meta[DECISION_META_KEY]`; import the constant rather than
  repeating its value.
- `AskUserQuestion` becomes a form-mode `elicitation/create` when the client
  advertises `elicitation.form`, otherwise it is denied.
- Unexpected control requests from the CLI are refused, never approved.

## Library use

```ts
import { createAgent, launch, parseLaunchArgs } from '@candy-mountain/claude-acp'

// In-process, over any ACP Stream (stdio when `stream` is omitted).
const agent = launch({ configDir, claudeArgs, stream })
agent.close()

// Or inside your own AgentSideConnection.
new AgentSideConnection((conn) => createAgent(conn, { configDir, claudeArgs }), stream)
```

`ClaudeAcpAgent`, `ClaudeProcess`, `ClaudeEventTranslator`,
`ClaudePermissionBridge` and `prepareClaudeLaunch` are exported for finer control.

## Development

```bash
pnpm --filter @candy-mountain/claude-acp test        # vitest, against a fake claude
pnpm --filter @candy-mountain/claude-acp build       # dist/cli.mjs
CLAUDE_ACP_TEST_BIN=$PWD/dist/cli.mjs pnpm exec vitest run   # same tests against the build
pnpm --filter @candy-mountain/claude-acp acp-client -- --help   # interactive operator client
```

The tests drive `src/test-support/claude-fixture.mjs`, a fake `claude` that
replays observed stream-json and control shapes; nothing in them contacts
Anthropic.
