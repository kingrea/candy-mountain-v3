import type { ApiErrorBody } from '@candy-mountain/platform-sdk'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, getWorkspaceBySlug, requireCapability } from '@candy-mountain/platform-daemon'
import { templateCapability } from './manifest'
import { createNote, listNotes } from './notes'
import { TEMPLATE_MANAGE_TOOL, TEMPLATE_NOTE_MAX_LENGTH, type TemplateNoteListResponse, type TemplateNoteResponse } from './wire'

const createNoteBody = z.object({ text: z.string().trim().min(1).max(TEMPLATE_NOTE_MAX_LENGTH) })

/** Mounted under /workspaces, so the paths start at the slug the gate reads. */
export function templateRoutes() {
  const app = new Hono<AppEnv>()
  const read = requireCapability({ capability: templateCapability.id, view: 'template' })
  const manage = requireCapability({ capability: templateCapability.id, tool: TEMPLATE_MANAGE_TOOL })

  app.get('/:slug/template/notes', read, (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    return c.json<TemplateNoteListResponse>({ notes: listNotes(c.var.db, workspace.id) })
  })

  app.post('/:slug/template/notes', manage, async (c) => {
    const body = createNoteBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json<ApiErrorBody>({ error: { code: 'invalid_request', message: `text must be 1 to ${TEMPLATE_NOTE_MAX_LENGTH} characters` } }, 400)
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    return c.json<TemplateNoteResponse>({ note: createNote(c.var.db, workspace, body.data.text, c.var.scopeUrlPrefix) }, 201)
  })

  return app
}
