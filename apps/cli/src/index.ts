#!/usr/bin/env node
import { runCli } from '@candy-mountain/platform-cli'
import { candyMountain } from './distribution'
import { REPO_ROOT } from './repo-root'

process.exitCode = await runCli(process.argv.slice(2), candyMountain(REPO_ROOT))
