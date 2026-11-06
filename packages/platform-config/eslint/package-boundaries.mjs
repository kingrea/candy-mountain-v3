import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const SCOPE = '@candy-mountain/'
const PLATFORM_PREFIX = `${SCOPE}platform-`
const CAPABILITY_PREFIX = `${SCOPE}cap-`
const WORKSPACE_FILE = 'pnpm-workspace.yaml'

const DIRECTIONS = 'Allowed: a capability or distribution -> a platform package\'s declared entries; a capability -> a dependency capability\'s root entry; never the reverse, never a relative path across package roots.'
const DOCS = '.ai-docs/plans/platform-extraction/overview.md'

/** The capability id a `@candy-mountain/cap-<id>` package name carries, or undefined for any other package. */
export function capabilityId(name) {
  return name.startsWith(CAPABILITY_PREFIX) ? name.slice(CAPABILITY_PREFIX.length) : undefined
}

/** `platform`, `capability` or `other` (a distribution, the product package or a library such as claude-acp). */
export function kindOf(name) {
  if (name.startsWith(PLATFORM_PREFIX)) return 'platform'
  return capabilityId(name) ? 'capability' : 'other'
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch {
    return undefined
  }
}

/** The nearest ancestor of `from` holding a pnpm-workspace.yaml, or undefined outside a workspace. */
export function workspaceRoot(from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, WORKSPACE_FILE))) return dir
    if (dirname(dir) === dir) return undefined
  }
}

// Only the `packages:` list matters; a glob is a parent directory plus `*`.
function workspaceGlobs(root) {
  let source
  try {
    source = readFileSync(join(root, WORKSPACE_FILE), 'utf8')
  }
  catch {
    return []
  }
  const globs = []
  let inPackages = false
  for (const line of source.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true
      continue
    }
    if (/^\S/.test(line)) inPackages = false
    const item = inPackages && /^\s*-\s*['"]?([^'"#\s]+)/.exec(line)
    if (item && !item[1].startsWith('!')) globs.push(item[1])
  }
  return globs
}

function packageDirs(root) {
  return workspaceGlobs(root).flatMap((glob) => {
    const star = /^(.*?)\/\*{1,2}\/?$/.exec(glob)
    if (!star) return [resolve(root, glob)]
    const parent = resolve(root, star[1])
    let entries
    try {
      entries = readdirSync(parent, { withFileTypes: true })
    }
    catch {
      return []
    }
    return entries.filter(entry => entry.isDirectory()).map(entry => join(parent, entry.name))
  })
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets)
  return []
}

// presets/ marks the entries config files alone may use (ncj.4.2); a package without exports has only its root.
function entriesOf(manifest) {
  const exports = manifest.exports
  if (!exports || typeof exports === 'string' || Object.keys(exports).every(key => !key.startsWith('.'))) {
    return { entries: ['.'], presets: [] }
  }
  const entries = Object.keys(exports)
  const presets = entries.filter(entry => exportTargets(exports[entry]).some(target => target.startsWith('./presets/')))
  return { entries, presets }
}

/**
 * Every package of the pnpm workspace at `root`, by name.
 * @param {string} root
 * @returns {Map<string, WorkspacePackage>}
 */
export function workspacePackages(root) {
  const packages = new Map()
  for (const dir of packageDirs(root)) {
    const manifest = readJson(join(dir, 'package.json'))
    if (typeof manifest?.name !== 'string') continue
    packages.set(manifest.name, {
      name: manifest.name,
      dir,
      kind: kindOf(manifest.name),
      capabilityId: capabilityId(manifest.name),
      dependencies: Object.keys(manifest.dependencies ?? {}),
      devDependencies: Object.keys(manifest.devDependencies ?? {}),
      ...entriesOf(manifest),
    })
  }
  return packages
}

/**
 * Where a capability package's dependencies on capability packages and its definition's dependsOn disagree; empty when they match.
 * @param {WorkspacePackage} pkg
 * @param {{ id: string, dependsOn?: readonly string[] }} definition
 * @param {Map<string, WorkspacePackage>} packages
 * @returns {string[]}
 */
export function capabilityDependencyDrift(pkg, definition, packages) {
  const problems = []
  if (definition.id !== pkg.capabilityId) problems.push(`${pkg.name} exports the definition of '${definition.id}', not '${pkg.capabilityId}'`)
  const byId = new Map([...packages.values()].filter(p => p.capabilityId).map(p => [p.capabilityId, p]))
  const declared = pkg.dependencies.filter(name => packages.get(name)?.kind === 'capability')
  const dependsOn = (definition.dependsOn ?? []).filter(id => byId.has(id))
  for (const name of declared) {
    const id = packages.get(name).capabilityId
    if (!dependsOn.includes(id)) problems.push(`${pkg.name} lists ${name} in its dependencies but its definition's dependsOn omits '${id}'`)
  }
  for (const id of dependsOn) {
    const name = byId.get(id).name
    if (!declared.includes(name)) problems.push(`${pkg.name}'s definition depends on '${id}' but its package.json dependencies omit ${name}`)
  }
  return problems
}

// A short lifetime keeps long-lived editor ESLint servers current as packages appear.
const indexes = new Map()
function indexOf(root) {
  const now = Date.now()
  const hit = indexes.get(root)
  if (hit && now - hit.at < 2000) return hit.value
  const value = workspacePackages(root)
  indexes.set(root, { at: now, value })
  return value
}

function inside(dir, file) {
  const rel = relative(dir, file)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

function ownerOf(packages, file) {
  let owner
  for (const pkg of packages.values()) {
    if (inside(pkg.dir, file) && (!owner || pkg.dir.length > owner.dir.length)) owner = pkg
  }
  return owner
}

/** The workspace package a bare specifier names and the entry it asks for, or undefined for any other module. */
function targetOf(packages, specifier) {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const pkg = packages.get(name)
  if (!pkg) return undefined
  const rest = specifier.slice(name.length)
  return { pkg, entry: rest ? `.${rest}` : '.' }
}

const CONFIG_FILE = /^[^/\\]*\.config\.[cm]?[jt]s$/

function projectOf(context) {
  const settings = context.settings?.['cm-packages'] ?? {}
  const root = settings.root ? resolve(settings.root) : workspaceRoot(dirname(context.filename))
  if (!root) return undefined
  const packages = indexOf(root)
  const owner = ownerOf(packages, context.filename)
  return owner ? { packages, owner, isConfig: CONFIG_FILE.test(basename(context.filename)) } : undefined
}

function staticString(node) {
  if (!node) return undefined
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return undefined
}

const MODULE_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock'])

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier')
    return `${callee.object.name}.${callee.property.name}`
  return undefined
}

function describe(pkg) {
  if (pkg.kind === 'platform') return `platform package ${pkg.name}`
  return pkg.kind === 'capability' ? `capability package ${pkg.name}` : `package ${pkg.name}`
}

const upperFirst = str => str[0].toUpperCase() + str.slice(1)

/** Visitors for every static import form, handing the source node to `check`. */
function importVisitors(check) {
  return {
    ImportDeclaration: node => check(node.source),
    ExportNamedDeclaration: node => node.source && check(node.source),
    ExportAllDeclaration: node => check(node.source),
    ImportExpression: node => check(node.source),
    TSImportType: node => check(node.source ?? node.argument?.literal),
    CallExpression(node) {
      const name = calleeName(node.callee)
      if (name === 'require' || (name?.startsWith('vi.') && MODULE_CALLS.has(name.slice(3)))) check(node.arguments[0])
    },
  }
}

function rule(description, messages, create) {
  return {
    meta: { type: 'problem', docs: { description, url: DOCS }, schema: [], messages },
    create(context) {
      const project = projectOf(context)
      if (!project) return {}
      return importVisitors((node) => {
        const source = staticString(node)
        if (source !== undefined) create(project, source, finding => context.report({ node, ...finding }), context.filename)
      })
    },
  }
}

const noRelativeCrossPackage = rule(
  'Forbid relative imports that leave the importing package\'s root',
  {
    leaves: '{{from}} may not import \'{{source}}\': the path leaves the package. Import {{to}} through its root entry. ' + DIRECTIONS,
    outside: '{{from}} may not import \'{{source}}\': the path leaves the package. ' + DIRECTIONS,
  },
  ({ packages, owner }, source, report, filename) => {
    if (!source.startsWith('.')) return
    const target = resolve(dirname(filename), source)
    if (inside(owner.dir, target)) return
    const to = ownerOf(packages, target)
    const data = { from: upperFirst(describe(owner)), source, to: to ? to.name : '' }
    report({ messageId: to ? 'leaves' : 'outside', data })
  },
)

const noSubpathImport = rule(
  'Forbid importing a workspace package through anything but its declared entries, a capability through anything but its root, or a preset outside a config file',
  {
    undeclared: '{{from}} may not import \'{{source}}\': {{to}} declares no \'{{entry}}\' entry. ' + DIRECTIONS,
    capability: '{{from}} may not import \'{{source}}\': a capability package is reachable only through its root entry \'{{to}}\'. ' + DIRECTIONS,
    preset: '{{from}} may not import \'{{source}}\' here: the preset entries of {{to}} are for config files (*.config.*) only. ' + DIRECTIONS,
  },
  ({ packages, owner, isConfig }, source, report) => {
    const target = targetOf(packages, source)
    if (!target || target.entry === '.') return
    const { pkg, entry } = target
    const data = { from: upperFirst(describe(owner)), source, to: pkg.name, entry }
    // A package's own entries are its own business (a web layer reaching its wire types past the daemon root).
    if (pkg.kind === 'capability' && pkg !== owner) report({ messageId: 'capability', data })
    else if (!pkg.entries.includes(entry)) report({ messageId: 'undeclared', data })
    else if (pkg.presets.includes(entry) && !isConfig) report({ messageId: 'preset', data })
  },
)

const noUndeclaredCapabilityImport = rule(
  'Forbid a capability package importing a capability package its package.json dependencies do not list',
  {
    undeclared: '{{from}} may not import \'{{source}}\': {{to}} is not in its package.json dependencies, so its definition cannot name \'{{id}}\' in dependsOn either. ' + DIRECTIONS,
  },
  ({ packages, owner }, source, report) => {
    if (owner.kind !== 'capability') return
    const target = targetOf(packages, source)
    if (!target || target.pkg === owner || target.pkg.kind !== 'capability') return
    if (owner.dependencies.includes(target.pkg.name)) return
    report({ messageId: 'undeclared', data: { from: upperFirst(describe(owner)), source, to: target.pkg.name, id: target.pkg.capabilityId } })
  },
)

const noCapabilityImportFromPlatform = rule(
  'Forbid a platform package importing a capability package',
  {
    forbidden: '{{from}} may not import \'{{source}}\': the platform never depends on a capability ({{to}}). ' + DIRECTIONS,
  },
  ({ packages, owner }, source, report) => {
    if (owner.kind !== 'platform') return
    const target = targetOf(packages, source)
    if (target?.pkg.kind !== 'capability') return
    report({ messageId: 'forbidden', data: { from: upperFirst(describe(owner)), source, to: target.pkg.name } })
  },
)

const noUnlistedDependency = rule(
  'Require every imported workspace package to be listed in the importing package\'s package.json, so Turborepo invalidates dependents',
  {
    unlisted: '{{from}} may not import \'{{source}}\': {{to}} is not in its package.json dependencies or devDependencies. ' + DIRECTIONS,
  },
  ({ packages, owner }, source, report) => {
    const target = targetOf(packages, source)
    if (!target || target.pkg === owner) return
    if (owner.dependencies.includes(target.pkg.name) || owner.devDependencies.includes(target.pkg.name)) return
    report({ messageId: 'unlisted', data: { from: upperFirst(describe(owner)), source, to: target.pkg.name } })
  },
)

const plugin = {
  meta: { name: 'cm-packages' },
  rules: {
    'no-relative-cross-package': noRelativeCrossPackage,
    'no-subpath-import': noSubpathImport,
    'no-undeclared-capability-import': noUndeclaredCapabilityImport,
    'no-capability-import-from-platform': noCapabilityImportFromPlatform,
    'no-unlisted-dependency': noUnlistedDependency,
  },
}

export default plugin

/** The config block that enables every rule as an error; the preset includes it for every package. */
export function packageBoundaries() {
  return {
    name: 'cm/package-boundaries',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { 'cm-packages': plugin },
    rules: {
      'cm-packages/no-relative-cross-package': 'error',
      'cm-packages/no-subpath-import': 'error',
      'cm-packages/no-undeclared-capability-import': 'error',
      'cm-packages/no-capability-import-from-platform': 'error',
      'cm-packages/no-unlisted-dependency': 'error',
    },
  }
}

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name
 * @property {string} dir
 * @property {'platform' | 'capability' | 'other'} kind
 * @property {string | undefined} capabilityId
 * @property {string[]} dependencies
 * @property {string[]} devDependencies
 * @property {string[]} entries
 * @property {string[]} presets
 */
