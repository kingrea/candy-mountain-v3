import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const FAKE_VERIFICATION_URL = 'https://auth.openai.com/codex/device'
export const FAKE_USER_CODE = 'ABCD-12345'

export interface FakeCodex {
  /** Put this first on PATH so `codex` resolves to the fake. */
  binDir: string
  bin: string
  /** Lets the waiting `login --device-auth` for that home finish as the browser would. */
  complete(home: string): void
  fail(home: string): void
  /** The environment the last login for that home ran with, once it has started. */
  loginEnv(home: string): Record<string, string> | undefined
  loginPid(home: string): number | undefined
}

// The real CLI only gets a curated environment, so the fake is steered through files in a control directory baked into the script.
const script = (control: string) => `#!/bin/sh
CONTROL='${control}'
KEY=$(basename "$CODEX_HOME")
if [ "$1 $2" = "login --device-auth" ]; then
  env > "$CONTROL/env-$KEY"
  echo $$ > "$CONTROL/pid-$KEY"
  printf '\\033[1mWelcome to Codex\\033[0m\\n\\nFollow these steps to sign in with ChatGPT using device code authorization:\\n\\n1. Open this link in your browser and sign in to your account\\n   \\033[94m${FAKE_VERIFICATION_URL}\\033[0m\\n\\n'
  sleep 0.05
  printf '2. Enter this one-time code \\033[90m(expires in 15 minutes)\\033[0m\\n   \\033[94m${FAKE_USER_CODE}\\033[0m\\n\\nDevice codes are a common phishing target. Never share this code.\\n'
  while :; do
    if [ -f "$CONTROL/complete-$KEY" ]; then
      printf 'token' > "$CODEX_HOME/auth.json"
      echo 'Successfully logged in'
      exit 0
    fi
    if [ -f "$CONTROL/fail-$KEY" ]; then
      echo 'Error logging in with device code: denied' >&2
      exit 1
    fi
    sleep 0.05
  done
fi
if [ "$1 $2" = "login status" ]; then
  if [ -f "$CODEX_HOME/auth.json" ]; then
    echo 'Logged in using ChatGPT' >&2
    exit 0
  fi
  echo 'Not logged in' >&2
  exit 1
fi
exit 2
`

export function installFakeCodex(root: string): FakeCodex {
  const binDir = join(root, 'bin')
  const control = join(root, 'control')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(control, { recursive: true })
  const bin = join(binDir, 'codex')
  writeFileSync(bin, script(control))
  chmodSync(bin, 0o755)
  const file = (name: string, home: string) => join(control, `${name}-${basename(home)}`)
  const read = (name: string, home: string) => (existsSync(file(name, home)) ? readFileSync(file(name, home), 'utf8') : undefined)
  return {
    binDir,
    bin,
    complete: home => writeFileSync(file('complete', home), ''),
    fail: home => writeFileSync(file('fail', home), ''),
    loginEnv(home) {
      const env = read('env', home)
      if (env === undefined) return undefined
      return Object.fromEntries(env.split('\n').filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
    },
    loginPid(home) {
      const pid = read('pid', home)
      return pid === undefined ? undefined : Number(pid.trim())
    },
  }
}
