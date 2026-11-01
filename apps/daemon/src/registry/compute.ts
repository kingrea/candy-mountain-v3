import {
  BOT_FAMILY_NAMES,
  BOT_WRITE_SCOPE_NAMES,
  botAgentId,
  BOTS_CAPABILITY_ID,
  NONE_RUNG,
  projectViewRoute,
  registrySystemGroup,
  type AnyCapabilityManifest,
  type BotFamily,
  type BotWriteScope,
  type CapabilityRungs,
  type DegradedModule,
  type ModuleDefinition,
  type ModuleId,
  type ReadinessReason,
  type RegistryAgent,
  type RegistryCapability,
  type RegistryNavEntry,
  type RegistryNavGroup,
  type RegistryResponse,
  type RegistryView,
  type Rung,
  type ScopeLabel,
} from '@candy-mountain/shared'
import { getRung } from '../capabilities'
import { rungOf } from '../grants/resolve'
import { capabilityReadiness, type PlatformFacts, type PluginReadiness, type ProjectFacts } from './readiness'

/** Plain data only, so the answer can be computed without a database. */
export interface RegistryInput {
  project: { id: string, slug: string, name: string }
  scopeUrlPrefix: string
  scopeLabel: ScopeLabel
  capabilities: readonly AnyCapabilityManifest[]
  modules: readonly ModuleDefinition[]
  enabledModules: readonly ModuleId[]
  rungs: CapabilityRungs
  admin: boolean
  /** Keyed by plugin type id, as resolved for this workspace. */
  plugins: Readonly<Record<string, PluginReadiness>>
  facts: ProjectFacts
  platformFacts?: PlatformFacts
  /** The workspace's bots that can run from the console. */
  bots?: readonly RegistryBotInput[]
}

export interface RegistryBotInput {
  id: string
  name: string
  family: BotFamily
  writeScope: BotWriteScope
  baseBranch: string | null
}

/** A capability is a candidate for a workspace through an enabled module, or on its own when it belongs to no module at all. */
export function candidateModules(cap: Pick<AnyCapabilityManifest, 'id'>, modules: readonly ModuleDefinition[], enabledModules: readonly ModuleId[]): { members: ModuleDefinition[], standalone: boolean } {
  const owners = modules.filter(mod => mod.capabilities.some(member => member.capabilityId === cap.id))
  return { members: owners.filter(mod => enabledModules.includes(mod.id)), standalone: owners.length === 0 }
}

/** The ladder rung an actor holds; a stale or missing name falls back to 'none'. */
export function actorRung(cap: AnyCapabilityManifest, rungs: CapabilityRungs): Rung {
  return getRung(cap, rungOf(rungs, cap.id)) ?? getRung(cap, NONE_RUNG)!
}

interface Assessed {
  cap: AnyCapabilityManifest
  rung: Rung
  granted: boolean
  members: ModuleDefinition[]
  standalone: boolean
  reasons: ReadinessReason[]
  ready: boolean
}

export function computeRegistry(input: RegistryInput): RegistryResponse {
  const { project, admin } = input
  const enabled = input.modules.filter(mod => input.enabledModules.includes(mod.id))
  const assessed = new Map<string, Assessed>()
  for (const cap of input.capabilities) {
    const rung = actorRung(cap, input.rungs)
    const reasons = capabilityReadiness(cap, input.scopeLabel, input.plugins, input.facts, input.platformFacts)
    assessed.set(cap.id, { cap, rung, granted: rung.name !== NONE_RUNG, ...candidateModules(cap, input.modules, input.enabledModules), reasons, ready: reasons.length === 0 })
  }
  const held = [...assessed.values()].filter(a => a.granted && (a.members.length > 0 || a.standalone))
  const visible = (a: Assessed) => admin || a.ready

  const entriesOf = (a: Assessed): RegistryNavEntry[] =>
    a.cap.views.filter(view => a.rung.views.includes(view.id)).map(view => ({ id: view.id, label: view.label, icon: view.icon, to: projectViewRoute(input.scopeUrlPrefix, project.slug, view.path) }))

  const moduleGroups: RegistryNavGroup[] = []
  for (const mod of enabled) {
    const members = mod.capabilities.map(member => assessed.get(member.capabilityId)).filter((a): a is Assessed => a !== undefined)
    const entries = members.filter(a => a.granted && visible(a)).flatMap(entriesOf)
    if (!entries.length) continue
    moduleGroups.push({ id: mod.id, label: mod.label, icon: mod.icon, kind: 'module', entries, degraded: admin && members.some(a => !a.ready) })
  }
  // A standalone capability holding the workspace home leads the sidebar; the rest follow the modules.
  const homeGroups: RegistryNavGroup[] = []
  const standaloneGroups: RegistryNavGroup[] = []
  for (const a of held.filter(a => a.standalone && visible(a))) {
    const entries = entriesOf(a)
    if (!entries.length) continue
    const target = a.cap.views.some(view => view.path === '' && a.rung.views.includes(view.id)) ? homeGroups : standaloneGroups
    target.push({ id: a.cap.id, label: a.cap.label, icon: entries[0]!.icon, kind: 'capability', entries, degraded: admin && !a.ready })
  }
  const groups = [...homeGroups, ...moduleGroups, ...standaloneGroups, registrySystemGroup(input.scopeLabel)]

  const views: RegistryView[] = held.flatMap(a =>
    a.cap.views.filter(view => a.rung.views.includes(view.id)).map(view => ({ id: view.id, capabilityId: a.cap.id, label: view.label, icon: view.icon, path: view.path, to: projectViewRoute(input.scopeUrlPrefix, project.slug, view.path), ready: a.ready })),
  )
  const chats = (a: Assessed | undefined) => a !== undefined && held.includes(a) && a.rung.chat && a.ready
  const agents: RegistryAgent[] = held.filter(chats).flatMap(a => a.cap.agents.map(agent => ({ id: agent.id, capabilityId: a.cap.id, label: agent.label, description: agent.description, ...(agent.family ? { family: agent.family } : {}), ...(agent.avatar ? { avatar: agent.avatar } : {}) })))
  // A bot session streams and asks through the session routes, which are gated on its family's chat capability.
  const familyChats = (family: BotFamily) => chats(assessed.get(input.capabilities.find(cap => cap.agents.some(agent => agent.family === family))?.id ?? ''))
  if (chats(assessed.get(BOTS_CAPABILITY_ID))) {
    for (const bot of input.bots ?? []) {
      if (!familyChats(bot.family)) continue
      agents.push({
        id: botAgentId(bot.id),
        capabilityId: BOTS_CAPABILITY_ID,
        label: bot.name,
        description: `${BOT_FAMILY_NAMES[bot.family]} bot, ${BOT_WRITE_SCOPE_NAMES[bot.writeScope].toLowerCase()}, working in its own worktree.`,
        family: bot.family,
        avatar: 'i-lucide-bot',
        kind: 'bot',
        bot: { id: bot.id, writeScope: bot.writeScope, baseBranch: bot.baseBranch },
      })
    }
  }
  const capabilities: RegistryCapability[] = held.map(a => ({
    id: a.cap.id,
    label: a.cap.label,
    rung: a.rung.name,
    chat: a.rung.chat,
    ready: a.ready,
    reasons: admin ? a.reasons : [],
    modules: a.members.map(mod => mod.id),
    views: [...a.rung.views],
    tools: Object.keys(a.rung.tools),
  }))

  const degraded: DegradedModule[] = admin
    ? enabled.flatMap((mod) => {
        const reasons = mod.capabilities.flatMap(member => (assessed.get(member.capabilityId)?.reasons ?? []).map(reason => ({ ...reason, capabilityId: member.capabilityId })))
        return reasons.length ? [{ id: mod.id, label: mod.label, reasons }] : []
      })
    : []

  return { project: { id: project.id, slug: project.slug, name: project.name }, admin, modules: enabled.map(mod => mod.id), groups, views, agents, capabilities, degraded }
}
