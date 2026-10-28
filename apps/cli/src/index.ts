#!/usr/bin/env node
import { main } from './main'
import { REPO_ROOT } from './repo-root'

process.exitCode = await main(process.argv.slice(2), { repoRoot: REPO_ROOT })
