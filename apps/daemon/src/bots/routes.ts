import type { ApiErrorBody, BotListResponse, BotPersonaCheckResponse, BotPersonaPreviewResponse, BotResponse } from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import type { SecretsReader } from '../plugins/instances/instances'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { SecretsLockedError } from '../secrets'
import { botProjectId, createBot, deleteBot, getBot, listBots, updateBot, type BotReadDeps } from './bots'
import { BotError } from './errors'
import { checkBotPersona, parsePersonaPreview, previewBotPersona } from './persona'
import { parseCreateBot, parseUpdateBot } from './validation'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new BotError('invalid_request', 'Request body must be valid JSON')
  }
}

/** Admin only, like plugin instances: bots hold Slack credentials. Takes the plaintext reader because it must never sit in `c.var`. */
export function botRoutes(secretsReader: SecretsReader) {
  const app = new Hono<AppEnv>()
  const admin = requireAdmin()
  app.onError((error, c) => {
    if (error instanceof BotError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    if (error instanceof SecretsLockedError) return c.json<ApiErrorBody>({ error: { code: 'secrets_locked', message: error.message } }, 409)
    throw error
  })

  const deps = (c: Context<AppEnv>): BotReadDeps => ({ ...c.var, secretsReader })
  const projectIdOf = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug')!).id
  const signal = (c: Context) => ({ signal: c.req.raw.signal })

  function botIdOf(c: Context<AppEnv>): string {
    const id = c.req.param('id')!
    if (botProjectId(c.var.db, id) !== projectIdOf(c)) throw new BotError('not_found', `No bot with id "${id}" in this project`)
    return id
  }

  app.get('/:slug/bots', admin, async c =>
    c.json<BotListResponse>({ bots: await listBots(deps(c), { projectId: projectIdOf(c), ...signal(c) }) }),
  )

  app.post('/:slug/bots', admin, async (c) => {
    const projectId = projectIdOf(c)
    const bot = await createBot(deps(c), projectId, parseCreateBot(await readJson(c)), signal(c))
    return c.json<BotResponse>({ bot }, 201)
  })

  app.post('/:slug/bots/check-persona', admin, async (c) => {
    const projectId = projectIdOf(c)
    const { personaName, baseBranch } = parsePersonaPreview(await readJson(c))
    return c.json<BotPersonaPreviewResponse>(await previewBotPersona(deps(c), projectId, personaName, baseBranch, signal(c)))
  })

  app.post('/:slug/bots/:id/check-persona', admin, async (c) => {
    const bot = await getBot(deps(c), botIdOf(c), signal(c))
    return c.json<BotPersonaCheckResponse>(await checkBotPersona(deps(c), bot, signal(c)))
  })

  app.get('/:slug/bots/:id', admin, async c => c.json<BotResponse>({ bot: await getBot(deps(c), botIdOf(c), signal(c)) }))

  app.patch('/:slug/bots/:id', admin, async (c) => {
    const id = botIdOf(c)
    return c.json<BotResponse>({ bot: await updateBot(deps(c), id, parseUpdateBot(await readJson(c)), signal(c)) })
  })

  app.delete('/:slug/bots/:id', admin, (c) => {
    deleteBot(c.var, botIdOf(c))
    return c.body(null, 204)
  })

  return app
}
