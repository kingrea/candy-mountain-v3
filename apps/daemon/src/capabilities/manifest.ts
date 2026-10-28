import {
  isCapabilityId,
  isPluginTypeId,
  MANIFEST_ID_PATTERN,
  NONE_RUNG,
  PLATFORM_FACT_IDS,
  PROJECT_FACT_IDS,
  TOOL_KINDS,
  VIEW_PATH_PATTERN,
  type AgentManifest,
  type AnyCapabilityManifest,
  type CapabilityId,
  type CapabilityManifest,
  type JobManifest,
  type PlatformFactId,
  type PluginTypeId,
  type ProjectFactId,
  type Rung,
  type ToolManifest,
  type ToolPermission,
  type ViewManifest,
} from '@candy-mountain/shared'

/** Thrown while defining or registering capabilities, so a bad manifest stops the daemon at boot. */
export class CapabilityManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityManifestError'
  }
}

export function defineCapability<const V extends string, const T extends string, const R extends string>(manifest: {
  id: CapabilityId
  label: string
  description: string
  views: readonly ViewManifest<V>[]
  agents: readonly AgentManifest[]
  projectAgents?: boolean
  jobs: readonly JobManifest[]
  requiresPlugins: readonly string[]
  requiresAnyPlugins?: readonly (readonly PluginTypeId[])[]
  requiresProjectFacts?: readonly ProjectFactId[]
  requiresPlatformFacts?: readonly PlatformFactId[]
  tools: readonly ToolManifest<T>[]
  ladder: readonly [Rung<NoInfer<V>, NoInfer<T>, typeof NONE_RUNG>, ...Rung<NoInfer<V>, NoInfer<T>, R>[]]
  everyoneRung?: NoInfer<R>
}): CapabilityManifest<V, T, R | typeof NONE_RUNG> {
  assertCapability(manifest)
  return manifest
}

export function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))]
}

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''
const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')

function permits(tool: ToolManifest, granted: ToolPermission | undefined, below: ToolPermission | undefined): boolean {
  if (!below) return true
  if (!granted) return false
  if (!tool.scope) return true
  return tool.scope.levels.indexOf(granted.scope!) >= tool.scope.levels.indexOf(below.scope!)
}

export function assertCapability(cap: AnyCapabilityManifest): void {
  const fail = (msg: string): never => {
    throw new CapabilityManifestError(`Capability '${String(cap.id)}': ${msg}`)
  }
  if (!isCapabilityId(cap.id)) {
    throw new CapabilityManifestError(`Unknown capability id '${String(cap.id)}'; add it to CAPABILITY_IDS in @candy-mountain/shared first.`)
  }
  if (isBlank(cap.label) || isBlank(cap.description)) fail('label and description must not be empty.')

  for (const [what, ids] of [
    ['view', cap.views.map(v => v.id)],
    ['agent', cap.agents.map(a => a.id)],
    ['job', cap.jobs.map(j => j.id)],
    ['tool', cap.tools.map(t => t.id)],
    ['rung', cap.ladder.map(r => r.name)],
    ['required plugin', cap.requiresPlugins],
  ] as const) {
    const bad = ids.filter(id => typeof id !== 'string' || !MANIFEST_ID_PATTERN.test(id))
    if (bad.length) fail(`invalid ${what} id(s) ${quoted(bad)}; ids are lowercase letters and digits joined by '-', '_' or '.'.`)
    const dup = duplicates(ids)
    if (dup.length) fail(`duplicate ${what} id(s) ${quoted(dup)}.`)
  }

  for (const group of cap.requiresAnyPlugins ?? []) {
    const unknown = group.filter(id => !isPluginTypeId(id))
    if (unknown.length) fail(`has unknown plugin type(s) ${quoted(unknown)} in an any-of group.`)
    if (duplicates(group).length) fail(`repeats plugin type(s) ${quoted(duplicates(group))} in an any-of group.`)
    if (group.length < 2) fail('an any-of plugin group needs at least two plugin types; put a single one in requiresPlugins.')
    const required = group.filter(id => cap.requiresPlugins.includes(id))
    if (required.length) fail(`plugin type(s) ${quoted(required)} are both required and in an any-of group.`)
  }

  const facts = cap.requiresProjectFacts ?? []
  const badFacts = facts.filter(fact => !(PROJECT_FACT_IDS as readonly string[]).includes(fact))
  if (badFacts.length) fail(`requires unknown project fact(s) ${quoted(badFacts)}; facts are ${quoted(PROJECT_FACT_IDS)}.`)
  if (duplicates(facts).length) fail(`repeats required project fact(s) ${quoted(duplicates(facts))}.`)
  const platformFacts = cap.requiresPlatformFacts ?? []
  const badPlatformFacts = platformFacts.filter(fact => !(PLATFORM_FACT_IDS as readonly string[]).includes(fact))
  if (badPlatformFacts.length) fail(`requires unknown platform fact(s) ${quoted(badPlatformFacts)}; facts are ${quoted(PLATFORM_FACT_IDS)}.`)
  if (duplicates(platformFacts).length) fail(`repeats required platform fact(s) ${quoted(duplicates(platformFacts))}.`)

  for (const view of cap.views) {
    if (isBlank(view.label) || isBlank(view.icon)) fail(`view '${view.id}' needs a label and an icon.`)
    if (typeof view.path !== 'string' || !VIEW_PATH_PATTERN.test(view.path)) {
      fail(`view '${view.id}' has invalid path '${String(view.path)}'; use lowercase segments relative to the project, without leading or trailing '/'.`)
    }
  }
  const dupPaths = duplicates(cap.views.map(v => v.path))
  if (dupPaths.length) fail(`duplicate view path(s) ${quoted(dupPaths)}.`)
  for (const item of [...cap.agents, ...cap.jobs]) {
    if (isBlank(item.label) || isBlank(item.description)) fail(`'${item.id}' needs a label and a description.`)
  }
  for (const tool of cap.tools) {
    if (!(TOOL_KINDS as readonly string[]).includes(tool.kind)) fail(`tool '${tool.id}' has unknown kind '${String(tool.kind)}'.`)
    if (!tool.scope) continue
    if (isBlank(tool.scope.dimension)) fail(`tool '${tool.id}' declares a scope without a dimension.`)
    if (!tool.scope.levels.length) fail(`tool '${tool.id}' declares a scope with no levels.`)
    if (duplicates(tool.scope.levels).length) fail(`tool '${tool.id}' repeats a scope level.`)
  }

  const [first] = cap.ladder
  if (!first || first.name !== NONE_RUNG) fail(`the ladder must start with a rung named '${NONE_RUNG}'.`)
  if (cap.everyoneRung !== undefined) {
    if (cap.everyoneRung === NONE_RUNG) fail(`everyoneRung '${NONE_RUNG}' grants nothing; leave it out instead.`)
    if (!cap.ladder.some(r => r.name === cap.everyoneRung)) fail(`everyoneRung '${cap.everyoneRung}' is not on the ladder.`)
  }
  if (first!.views.length || first!.chat || Object.keys(first!.tools).length) fail(`rung '${NONE_RUNG}' must grant nothing.`)

  const viewIds = new Set(cap.views.map(v => v.id))
  const toolsById = new Map(cap.tools.map(t => [t.id, t]))
  cap.ladder.forEach((rung, i) => {
    const at = `rung '${rung.name}'`
    if (isBlank(rung.label) || isBlank(rung.description)) fail(`${at} needs a label and a description.`)
    for (const v of rung.views) if (!viewIds.has(v)) fail(`${at} shows unknown view '${v}'.`)
    if (rung.chat && !cap.agents.length && !cap.projectAgents) fail(`${at} allows chat but the capability has no agents.`)
    for (const [id, perm] of Object.entries(rung.tools) as [string, ToolPermission | undefined][]) {
      const tool = toolsById.get(id)
      if (!tool) return fail(`${at} grants unknown tool '${id}'.`)
      if (!perm) continue
      if (tool.scope && !tool.scope.levels.includes(perm.scope ?? '')) {
        fail(`${at} must grant '${id}' one of the scope levels ${quoted(tool.scope.levels)}.`)
      }
      if (!tool.scope && perm.scope !== undefined) fail(`${at} grants a scope on unscoped tool '${id}'.`)
    }

    const below = cap.ladder[i - 1]
    if (!below) return
    const hidden = below.views.filter(v => !rung.views.includes(v))
    if (hidden.length) fail(`${at} hides view(s) ${quoted(hidden)} that '${below.name}' shows; rungs must be monotonic.`)
    if (below.chat && !rung.chat) fail(`${at} drops chat that '${below.name}' allows; rungs must be monotonic.`)
    for (const tool of cap.tools) {
      const key = tool.id as keyof typeof rung.tools
      if (!permits(tool, rung.tools[key], below.tools[key])) {
        fail(`${at} grants less on tool '${tool.id}' than '${below.name}'; rungs must be monotonic.`)
      }
    }
  })
}

export function getRung<V extends string, T extends string, R extends string>(cap: CapabilityManifest<V, T, R>, name: string): Rung<V, T, R> | undefined {
  return cap.ladder.find(r => r.name === name)
}

/** 0 for 'none'; -1 when the capability has no such rung. */
export const rungIndex = (cap: AnyCapabilityManifest, name: string): number => cap.ladder.findIndex(r => r.name === name)

export const topRung = <V extends string, T extends string, R extends string>(cap: CapabilityManifest<V, T, R>): Rung<V, T, R> =>
  cap.ladder[cap.ladder.length - 1]!
