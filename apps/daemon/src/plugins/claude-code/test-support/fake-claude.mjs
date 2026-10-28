import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

// A stand-in for the stock `claude` binary: only `auth login --claudeai` and `auth status --json`.
// Login success leaves a marker file in CLAUDE_CONFIG_DIR; it is never a real credential.
const args = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR;
const mode = process.env.FAKE_CLAUDE_MODE ?? '';
const expectedCode = process.env.FAKE_CLAUDE_CODE ?? 'good#state';
const marker = join(configDir ?? '', 'fake-login.json');
const json = (value) => process.stdout.write(JSON.stringify(value) + '\n');

if (configDir) {
  mkdirSync(configDir, { recursive: true });
  // What the daemon handed the child, so tests can prove the environment was curated.
  writeFileSync(join(configDir, 'fake-env.json'), JSON.stringify({
    args,
    pid: process.pid,
    apiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    oauthToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    authEnv: Object.keys(process.env).filter(name => /^ANTHROPIC_|^CLAUDE_CODE_(USE_|OAUTH_REFRESH|OAUTH_SCOPES)/.test(name)),
  }));
}

if (args.join(' ') === 'auth status --json') {
  if (mode === 'hang') { setTimeout(() => {}, 60_000); }
  else if (mode === 'garbage') { process.stdout.write('not json\n'); process.exit(0); }
  else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN === 'bad-token') json({ loggedIn: false });
    else json({ loggedIn: true, authMethod: 'oauth_token', subscriptionType: 'Claude Max' });
    process.exit(0);
  }
  else if (existsSync(marker)) {
    const saved = JSON.parse(readFileSync(marker, 'utf8'));
    json({ loggedIn: true, authMethod: 'claude.ai', email: saved.email, subscriptionType: 'Claude Max' });
    process.exit(0);
  }
  else { json({ loggedIn: false }); process.exit(0); }
}
else if (args.join(' ') === 'auth login --claudeai') {
  if (mode === 'no-url') { setTimeout(() => {}, 60_000); }
  else if (mode === 'exit-early') { process.stderr.write('Error: cannot start\n'); process.exit(1); }
  else {
    process.stdout.write('\u001b[1mOpening browser to sign in…\u001b[0m\n');
    // The real CLI prints the link as an OSC 8 hyperlink.
    const url = 'https://claude.ai/oauth/authorize?code=true&state=s1';
    process.stdout.write(`If the browser didn't open, visit: \u001b]8;;${url}\u0007${url}\u001b]8;;\u0007\n`);
    process.stdout.write('Paste code here if prompted > ');
    const lines = readline.createInterface({ input: process.stdin });
    let answered = false;
    for await (const line of lines) {
      answered = true;
      if (line.trim() === expectedCode) {
        writeFileSync(marker, JSON.stringify({ email: 'owner@example.com' }));
        process.stdout.write('Login successful\n');
        process.exit(0);
      }
      process.stderr.write('Invalid code\n');
      process.exit(1);
    }
    process.exit(answered ? 0 : 1);
  }
}
else {
  process.stderr.write(`fake claude: unsupported arguments ${args.join(' ')}\n`);
  process.exit(2);
}
