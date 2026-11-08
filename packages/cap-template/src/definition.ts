import { bindService, defineCapabilityDefinition, serviceKey, type ActivityEventTypeDeclaration, type CapabilityDefinition, type WorkspaceFactDeclaration } from '@candy-mountain/platform-sdk/daemon'
import { templateCapability } from './manifest'
import { hasNotes, NOTE_CREATED_EVENT } from './notes'
import { srcPath } from './package-root'
import { templateRoutes } from './routes'
import * as templateSchema from './schema'
import { startTicker, type TemplateTicker } from './ticker'

/** Bound so a dependent (or a test) can reach the ticker; a dependent must name 'template' in dependsOn to resolve it. */
export const TEMPLATE_TICKER = serviceKey<TemplateTicker>('template.ticker')

export const TEMPLATE_ACTIVITY_EVENT_TYPES: readonly ActivityEventTypeDeclaration[] = [
  { id: NOTE_CREATED_EVENT, label: 'Note added', icon: 'i-lucide-sticky-note', notifications: [{ id: NOTE_CREATED_EVENT, label: 'A note is added' }] },
]

// Facts are booleans, so the count becomes "has any"; another manifest could require it in requiresWorkspaceFacts.
export const TEMPLATE_WORKSPACE_FACTS: readonly WorkspaceFactDeclaration[] = [
  { id: 'hasTemplateNotes', compute: (db, workspace) => hasNotes(db, workspace.id), message: label => `The ${label.singular} has no template notes yet.` },
]

export interface TemplateOptions {
  tickIntervalMs?: number
}

export function templateDefinition({ tickIntervalMs = 60_000 }: TemplateOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: templateCapability.id,
    manifest: templateCapability,
    schema: { schema: templateSchema, migrationsFolder: srcPath('migrations') },
    provides: [TEMPLATE_TICKER],
    activityEventTypes: TEMPLATE_ACTIVITY_EVENT_TYPES,
    workspaceFacts: TEMPLATE_WORKSPACE_FACTS,
    start() {
      const ticker = startTicker(tickIntervalMs)
      return {
        services: [bindService(TEMPLATE_TICKER, ticker)],
        workspaceRoutes: [templateRoutes()],
        close: () => ticker.stop(),
      }
    },
  })
}
