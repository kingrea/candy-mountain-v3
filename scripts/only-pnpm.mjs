const agent = process.env.npm_config_user_agent ?? ''

if (!agent.startsWith('pnpm/')) {
  console.error('This repository uses pnpm. Run `pnpm install` instead.')
  process.exit(1)
}
