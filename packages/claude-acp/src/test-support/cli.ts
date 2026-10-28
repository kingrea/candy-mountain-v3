import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));

/** Runs the CLI from source through tsx, or a built entry named by CLAUDE_ACP_TEST_BIN. */
export function cliCommand(args: string[] = []): { command: string; args: string[] } {
  const bin = process.env.CLAUDE_ACP_TEST_BIN;
  if (bin) return { command: process.execPath, args: [bin, ...args] };
  const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  return { command: process.execPath, args: ['--import', loader, SOURCE_CLI, ...args] };
}
