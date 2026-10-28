#!/usr/bin/env node
import { launch, LAUNCH_USAGE, LaunchUsageError, parseLaunchArgs, type ClaudeLaunchOptions } from './launch';

const argv = process.argv.slice(2);
if (argv[0] === '--help' || argv[0] === '-h') {
  process.stdout.write(`${LAUNCH_USAGE}\n`);
  process.exit(0);
}

let options: ClaudeLaunchOptions;
try {
  options = parseLaunchArgs(argv);
} catch (error) {
  if (!(error instanceof LaunchUsageError)) throw error;
  process.stderr.write(`${error.message}\n\n${LAUNCH_USAGE}\n`);
  process.exit(2);
}

const { connection, close } = launch(options);
process.once('SIGTERM', () => { close(); process.exit(0); });
process.once('SIGINT', () => { close(); process.exit(0); });
connection.closed.catch((error: unknown) => { process.stderr.write(`ACP connection failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); });
