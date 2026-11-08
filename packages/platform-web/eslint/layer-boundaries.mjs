import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspacePackages, workspaceRoot } from '@candy-mountain/platform-config/package-boundaries'
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import ts from 'typescript'
import { hasNuxtConfig, packageLayers, PLATFORM_DIR, platformLayers } from '../layer-list.mjs'
import { camelCase, COMPONENT_FILE, componentName, layerPrefix, NOT_A_COMPONENT, splitByCase, upperFirst } from '../naming.mjs'
import { SCOPE_PAGES_DIR } from '../scope-routes.mjs'

export const SHARED_LAYER = 'chat'

// The shell's layer name (its nuxt.config $meta), so #layers/platform-web/... is a core import.
export const PLATFORM_LAYER = 'platform-web'

// The one capability whose manifest view path is '' owns the project home, app/pages/p/[project]/index.vue.
export const PROJECT_HOME_LAYER = 'overview'

// A layer may always use its own files; packages such as @candy-mountain/platform-sdk are never restricted unless they are layer packages or the platform package.
// A plugin-type layer (no manifest, no pages) is a capability layer here.
export const ALLOWED = {
  core: ['shared'],
  shared: ['core'],
  capability: ['core', 'shared'],
}

// A layer package keeps its daemon entry under src/; the daemon rule set owns those files.
export const DAEMON_SOURCE = 'src'

const DIRECTIONS = 'Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.'
const DOCS = 'packages/platform-web/README.md'
const LAYER_ID = /^[a-z][a-z\d]*(?:-[a-z\d]+)*$/
const NUXT_CONFIG = /^nuxt\.config\.[cm]?[jt]s$/
const APP_CONFIG = /^app\/app\.config\.[cm]?[jt]s$/
const PROJECT_PAGES = [SCOPE_PAGES_DIR, '[project]']
const TOOLING_CONFIG = /^(?:eslint|vitest)\.config\.[cm]?[jt]s$/
// A layer's tests and the one subpath of the platform package they may import: the web test kit.
const LAYER_TESTS = 'test'
const TEST_ENTRY = 'test'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch {
    return undefined
  }
}

function realDir(path) {
  try {
    return realpathSync(path)
  }
  catch {
    return resolve(path)
  }
}

function inside(dir, file) {
  const rel = relative(dir, file)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

// A short lifetime keeps long-lived editor ESLint servers current as layers change.
function cached(store, key, compute) {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && now - hit.at < 2000) return hit.value
  const value = compute()
  store.set(key, { at: now, value })
  return value
}

const dependsOn = (manifest, name) => Boolean(name) && name in { ...manifest?.devDependencies, ...manifest?.dependencies }

function workspaceMembers(workspace) {
  if (!workspace) return []
  return [...workspacePackages(workspace).values()].map(({ dir }) => ({ dir: realDir(dir), manifest: readJson(join(dir, 'package.json')) }))
}

/**
 * The linted root and what it sees. A web app (the distribution, or the platform package itself) is its own app
 * and sees the layer packages it depends on. A layer package (its package.json says `webLayer`) is linted as the
 * apps extending it see it: each workspace package depending on it and on the platform package is such an app and
 * lends its layers/ directories, and every workspace layer package is a sibling it may not use.
 */
function describeProject(root, platform, workspace) {
  const manifest = readJson(join(root, 'package.json'))
  const platformName = readJson(join(platform, 'package.json'))?.name
  const base = { root, platform, platformName, platformLayers: platformLayers(platform) }
  if (typeof manifest?.webLayer !== 'string') return { ...base, apps: [root], packages: packageLayers(root) }

  const members = workspaceMembers(workspace ?? workspaceRoot(root))
  const apps = members
    .filter(({ manifest: app }) => typeof app.webLayer !== 'string' && dependsOn(app, manifest.name) && dependsOn(app, platformName))
    .map(({ dir }) => dir)
  const packages = new Map()
  for (const { dir, manifest: member } of members) {
    if (typeof member.webLayer === 'string') packages.set(member.webLayer, { name: member.name, dir })
  }
  for (const dir of [...apps, root]) for (const [id, pkg] of packageLayers(dir)) packages.set(id, pkg)
  packages.set(manifest.webLayer, { name: manifest.name, dir: realDir(root) })
  return { ...base, apps, packages }
}

const projects = new Map()

/** Tests point root, platform and workspace at fixtures through settings. */
function projectOf(context) {
  const settings = context.settings?.['cm-layers'] ?? {}
  const root = resolve(settings.root ?? context.cwd)
  const platform = settings.platform ? resolve(settings.platform) : PLATFORM_DIR
  const workspace = settings.workspace ? resolve(settings.workspace) : undefined
  const key = [root, platform, workspace].join('\n')
  return cached(projects, key, () => ({ key, ...describeProject(root, platform, workspace) }))
}

/** Where `~/` and `~~/` point: the app's root, which for a layer package is the app that extends it. */
const appRoot = project => project.apps[0] ?? project.root

function layerRoot(project, layer) {
  if (layer === PLATFORM_LAYER) return project.platform
  const pkg = project.packages.get(layer)
  if (pkg) return pkg.dir
  if (project.platformLayers.includes(layer)) return join(project.platform, 'layers', layer)
  return join(project.apps.find(app => existsSync(join(app, 'layers', layer))) ?? appRoot(project), 'layers', layer)
}

/** `core` or a layer name for a file under `base`; null for a stray file in its layers/ directory; undefined outside it. */
function layerUnder(base, file) {
  const rel = relative(base, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined
  const parts = rel.split(sep)
  if (parts[0] !== 'layers') return 'core'
  if (parts.length < 2 || (parts.length === 2 && extname(parts[1]))) return null
  return parts[1]
}

/** `core`, a layer name, or null for files outside the web apps, the platform package and the layer packages. */
function ownerOfPath(project, file) {
  for (const [id, { dir }] of project.packages) if (inside(dir, file)) return id
  return layerUnder(project.platform, file) ?? project.apps.map(app => layerUnder(app, file)).find(owner => owner !== undefined) ?? null
}

/** The owner whose rules a linted file obeys: as ownerOfPath, except a layer package's daemon source obeys none. */
function subjectOf(project, file) {
  for (const { dir } of project.packages.values()) {
    if (inside(dir, file)) return relative(dir, file).split(sep)[0] === DAEMON_SOURCE ? null : ownerOfPath(project, file)
  }
  return ownerOfPath(project, file)
}

function kindOf(owner) {
  if (owner === 'core') return 'core'
  return owner === SHARED_LAYER ? 'shared' : 'capability'
}

function isAllowed(from, to) {
  return from === to || ALLOWED[kindOf(from)].includes(kindOf(to))
}

function describe(owner) {
  if (owner === 'core') return 'the core app'
  return kindOf(owner) === 'shared' ? `the shared \`${owner}\` layer` : `the \`${owner}\` capability layer`
}

function forbiddenOwner(from, owners) {
  if (!owners?.size || [...owners].some(owner => isAllowed(from, owner))) return undefined
  return [...owners][0]
}

/** True when an auto-imported name identifies its layer: useIssuesBoard, IssuesRow, issuesPath, ISSUES_PAGE_SIZE. */
export function hasLayerPrefix(name, layer) {
  const pascal = layerPrefix(layer)
  const camel = pascal[0].toLowerCase() + pascal.slice(1)
  const screaming = splitByCase(layer).join('_').toUpperCase()
  const bare = name.replace(/^use(?=[A-Z])/, '')
  return new RegExp(`^(?:${pascal}|${camel})(?:$|[A-Z\\d_])`).test(bare) || new RegExp(`^${screaming}(?:$|_)`).test(name)
}

/** Template tags and #components imports may be kebab-case and Lazy-prefixed. */
function componentKey(name) {
  return name.replace(/^(?:Lazy|lazy-)/, '').replace(/[-_]/g, '').toLowerCase()
}

const SCRIPT_FILE = /\.(?:ts|js|mjs|mts)$/
const INDEX_FILES = ['index.ts', 'index.js', 'index.mjs', 'index.mts']
const AUTO_IMPORT_DIRS = ['app/composables', 'app/utils', 'shared/utils', 'shared/types']

function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return []
  }
}

function walk(dir) {
  return entries(dir).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

/** Nuxt auto-imports top-level files and `<dir>/index.*`, nothing deeper. */
function autoImportFiles(dir) {
  return entries(dir).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isFile()) return SCRIPT_FILE.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
    if (!entry.isDirectory()) return []
    const index = INDEX_FILES.map(f => join(full, f)).find(f => existsSync(f))
    return index ? [index] : []
  })
}

function isAutoImportFile(project, layer, file) {
  return AUTO_IMPORT_DIRS.some((dir) => {
    const rel = relative(join(layerRoot(project, layer), dir), file)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
    const parts = rel.split(sep)
    if (parts.length === 1) return SCRIPT_FILE.test(rel) && !rel.endsWith('.d.ts')
    return parts.length === 2 && INDEX_FILES.includes(parts[1])
  })
}

function defaultExportName(file) {
  const base = basename(file, extname(file))
  return camelCase(base === 'index' ? basename(dirname(file)) : base)
}

function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap(el => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)))
}

function exportedNames(file) {
  let source
  try {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
  }
  catch {
    return []
  }
  const names = []
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : []
    const exported = modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    const isDefault = modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
    if ((ts.isExportAssignment(statement) && !statement.isExportEquals) || (exported && isDefault)) names.push(defaultExportName(file))
    else if (exported && ts.isVariableStatement(statement))
      names.push(...statement.declarationList.declarations.flatMap(declaration => bindingNames(declaration.name)))
    else if (exported && statement.name && ts.isIdentifier(statement.name)) names.push(statement.name.text)
    else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause))
      names.push(...statement.exportClause.elements.map(el => el.name.text))
  }
  return names
}

function addOwner(map, key, owner) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(owner)
}

/** Nuxt skips a layer that has no nuxt.config. */
function registeredLayers(project) {
  const packages = project.packages
  const local = project.apps.flatMap((app) => {
    const layersDir = join(app, 'layers')
    return entries(layersDir)
      .filter(entry => entry.isDirectory() && !packages.has(entry.name) && hasNuxtConfig(join(layersDir, entry.name)))
      .map(entry => entry.name)
  })
  return [...new Set([...project.platformLayers, ...local, ...[...packages].filter(([, { dir }]) => hasNuxtConfig(dir)).map(([id]) => id)])]
}

function scanLayers(project) {
  const exports = new Map()
  const components = new Map()
  const componentCount = new Map()
  for (const layer of registeredLayers(project)) {
    const base = layerRoot(project, layer)
    for (const dir of AUTO_IMPORT_DIRS) {
      for (const file of autoImportFiles(join(base, dir))) {
        for (const name of exportedNames(file)) addOwner(exports, name, layer)
      }
    }
    const componentsDir = join(base, 'app/components')
    const files = walk(componentsDir).filter(file => COMPONENT_FILE.test(file) && !NOT_A_COMPONENT.test(file))
    for (const file of files) addOwner(components, componentKey(componentName(componentsDir, file, layerPrefix(layer))), layer)
    componentCount.set(layer, files.length)
  }
  return { exports, components, componentCount }
}

const scans = new Map()
const layerIndex = project => cached(scans, project.key, () => scanLayers(project))

function staticString(node) {
  if (!node) return undefined
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0) return node.quasis[0].value.cooked
    const head = node.quasis[0].value.cooked ?? ''
    if (/^#layers\/[^/]+\//.test(head)) return head
  }
  return undefined
}

/** Absolute target of an import source, or undefined for non-layer packages and virtual modules. */
function resolveSource(project, source, filename) {
  if (source.startsWith('.')) return resolve(dirname(filename), source)
  const layer = /^#layers\/([^/]+)(\/.*)?$/.exec(source)
  if (layer) return join(layerRoot(project, layer[1]), layer[2] ?? '')
  // Nuxt's localLayerAliases can point ~/ at the layer's own app/ at build time, but typecheck always means the root app.
  if (/^[~@]\//.test(source)) return join(appRoot(project), 'app', source.slice(2))
  if (/^(?:~~|@@)\//.test(source)) return join(appRoot(project), source.slice(3))
  if (isAbsolute(source)) return source
  const named = [...project.packages.values(), { name: project.platformName, dir: project.platform }]
  for (const { name, dir } of named) {
    if (name && (source === name || source.startsWith(`${name}/`))) return join(dir, source.slice(name.length))
  }
  return undefined
}

const MODULE_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock'])

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier')
    return `${callee.object.name}.${callee.property.name}`
  return undefined
}

function layerOf(context) {
  const project = projectOf(context)
  const owner = subjectOf(project, context.filename)
  return { project, owner, layer: owner && owner !== 'core' ? owner : null }
}

/** Visitors calling `check` with the source node of every static import, re-export, import type, require and vi.mock. */
function moduleSources(check, importDeclaration = node => check(node.source)) {
  return {
    ImportDeclaration: importDeclaration,
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

const noCrossLayerImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid explicit imports that cross a web layer boundary', url: DOCS },
    schema: [],
    messages: {
      forbidden: '{{from}} may not import from {{to}} (\'{{source}}\'). ' + DIRECTIONS + ' Shared wire types belong in @candy-mountain/platform-sdk.',
      forbiddenName: '{{from}} may not import \'{{name}}\' from {{source}}: it belongs to {{to}}. ' + DIRECTIONS,
    },
  },
  create(context) {
    const { project, owner: from } = layerOf(context)
    if (!from) return {}

    function checkSource(node) {
      const source = staticString(node)
      if (source === undefined) return
      const target = resolveSource(project, source, context.filename)
      const to = target && ownerOfPath(project, target)
      if (!to || isAllowed(from, to)) return
      context.report({ node, messageId: 'forbidden', data: { from: upperFirst(describe(from)), to: describe(to), source } })
    }

    function checkVirtual(node) {
      const source = node.source.value
      const kind = source === '#components' ? 'components' : source === '#imports' ? 'exports' : undefined
      if (!kind) return checkSource(node.source)
      const map = layerIndex(project)[kind]
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') continue
        const name = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
        const owner = forbiddenOwner(from, map.get(kind === 'components' ? componentKey(name) : name))
        if (owner) {
          context.report({ node: specifier, messageId: 'forbiddenName', data: { from: upperFirst(describe(from)), to: describe(owner), name, source } })
        }
      }
    }

    return moduleSources(checkSource, checkVirtual)
  },
}

const noPlatformPackageImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid a layer outside the platform package from importing it by package name or path', url: DOCS },
    schema: [],
    messages: {
      forbidden: '{{from}} may not import {{platform}} by package name or path (\'{{source}}\'). '
        + 'Reach core through its auto-imports, #imports, #components or #layers/' + PLATFORM_LAYER + '/…; wire types belong in @candy-mountain/platform-sdk.',
      tests: '{{from}}\'s tests may import only {{platform}}/' + TEST_ENTRY + ' from the platform package (\'{{source}}\'). '
        + 'Reach core through #imports, #components or #layers/' + PLATFORM_LAYER + '/…; wire types belong in @candy-mountain/platform-sdk.',
    },
  },
  create(context) {
    const { project, layer } = layerOf(context)
    if (!layer || inside(project.platform, context.filename)) return {}
    const rel = relative(layerRoot(project, layer), context.filename)
    // A layer package's lint and test configs take their presets from the platform package.
    if (TOOLING_CONFIG.test(rel)) return {}
    const inTests = rel.split(sep)[0] === LAYER_TESTS
    const name = project.platformName
    const testEntry = source => Boolean(name) && (source === `${name}/${TEST_ENTRY}` || source.startsWith(`${name}/${TEST_ENTRY}/`))

    function check(node) {
      const source = staticString(node)
      if (source === undefined) return
      const byName = Boolean(name) && (source === name || source.startsWith(`${name}/`))
      const byPath = (source.startsWith('.') || isAbsolute(source)) && inside(project.platform, resolveSource(project, source, context.filename))
      if (!byName && !byPath) return
      if (inTests && testEntry(source)) return
      context.report({ node, messageId: inTests ? 'tests' : 'forbidden', data: { from: upperFirst(describe(layer)), platform: name ?? 'the platform package', source } })
    }

    return moduleSources(check)
  },
}

const noCrossLayerAutoImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid auto-imported components, composables and utils from a layer the file may not depend on', url: DOCS },
    schema: [],
    messages: {
      component: '<{{name}}> belongs to {{to}}; {{from}} may not use it. ' + DIRECTIONS,
      identifier: '\'{{name}}\' is auto-imported from {{to}}; {{from}} may not use it. ' + DIRECTIONS,
    },
  },
  create(context) {
    const { project, owner: from } = layerOf(context)
    if (!from) return {}
    const sourceCode = context.sourceCode
    const index = layerIndex(project)

    function checkComponent(node, name) {
      const owner = forbiddenOwner(from, index.components.get(componentKey(name)))
      if (owner) context.report({ node, messageId: 'component', data: { name, from: describe(from), to: describe(owner) } })
    }

    function checkIdentifier(node, name) {
      const owner = forbiddenOwner(from, index.exports.get(name))
      if (owner) context.report({ node, messageId: 'identifier', data: { name, from: describe(from), to: describe(owner) } })
    }

    // Configured globals (Nuxt's import registry) have no defs; only real declarations shadow an auto-import.
    let scriptNames
    function declaredInScript(name) {
      if (!scriptNames) {
        const global = sourceCode.scopeManager?.globalScope
        const scopes = global ? [global, ...global.childScopes.filter(scope => scope.type === 'module')] : []
        scriptNames = new Set(scopes.flatMap(scope => scope.variables.filter(variable => variable.defs.length > 0).map(variable => variable.name)))
      }
      return scriptNames.has(name)
    }

    const scriptVisitor = {
      'Program:exit'() {
        const global = sourceCode.scopeManager?.globalScope
        if (!global) return
        const references = [
          ...global.through,
          ...global.variables.filter(variable => variable.defs.length === 0).flatMap(variable => variable.references),
        ]
        for (const reference of references) checkIdentifier(reference.identifier, reference.identifier.name)
      },
      CallExpression(node) {
        const name = calleeName(node.callee)
        const arg = staticString(node.arguments[0])
        if (arg === undefined) return
        if (name === 'resolveComponent' || name === 'mockComponent') checkComponent(node.arguments[0], arg)
        else if (name === 'mockNuxtImport') checkIdentifier(node.arguments[0], arg)
      },
    }

    const defineTemplateBodyVisitor = sourceCode.parserServices?.defineTemplateBodyVisitor
    if (!defineTemplateBodyVisitor) return scriptVisitor
    return defineTemplateBodyVisitor(
      {
        VElement(node) {
          checkComponent(node.startTag, node.rawName)
        },
        VExpressionContainer(node) {
          for (const reference of node.references ?? []) {
            if (!reference.variable && !declaredInScript(reference.id.name)) checkIdentifier(reference.id, reference.id.name)
          }
        },
      },
      scriptVisitor,
    )
  },
}

function bindingIdentifiers(pattern) {
  switch (pattern?.type) {
    case 'Identifier': return [pattern]
    case 'ObjectPattern': return pattern.properties.flatMap(p => bindingIdentifiers(p.type === 'RestElement' ? p.argument : p.value))
    case 'ArrayPattern': return pattern.elements.flatMap(bindingIdentifiers)
    case 'AssignmentPattern': return bindingIdentifiers(pattern.left)
    case 'RestElement': return bindingIdentifiers(pattern.argument)
    default: return []
  }
}

const layerPrefixRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require every name a layer auto-registers to carry the layer prefix', url: DOCS },
    schema: [],
    messages: {
      unprefixed: '\'{{name}}\' is auto-imported from the `{{layer}}` layer and must carry its prefix ({{examples}}). See ' + DOCS + '.',
      exportAll: '`export *` hides which names the `{{layer}}` layer auto-imports; export each name explicitly with the layer prefix.',
      componentsPrefix: 'Layer `{{layer}}` must register its components with `components: [{ path: \'./components\', prefix: \'{{prefix}}\' }]`. See ' + DOCS + '.',
      layerId: 'Layer directory `{{layer}}` must be a lowercase kebab-case capability or plugin type id (or `' + SHARED_LAYER + '`).',
    },
  },
  create(context) {
    const { project, layer } = layerOf(context)
    if (!layer) return {}
    const rel = relative(layerRoot(project, layer), context.filename)

    if (NUXT_CONFIG.test(rel)) {
      const prefix = layerPrefix(layer)
      const configured = []
      return {
        Property(node) {
          const key = node.key.type === 'Identifier' ? node.key.name : node.key.value
          if (key === 'prefix' && node.value.type === 'Literal') configured.push(node.value.value)
        },
        'Program:exit'(program) {
          if (!LAYER_ID.test(layer)) context.report({ node: program, messageId: 'layerId', data: { layer } })
          const hasComponents = (layerIndex(project).componentCount.get(layer) ?? 0) > 0
          if (configured.some(p => p !== prefix) || (hasComponents && !configured.includes(prefix)))
            context.report({ node: program, messageId: 'componentsPrefix', data: { layer, prefix } })
        },
      }
    }

    if (!isAutoImportFile(project, layer, context.filename)) return {}
    const pascal = layerPrefix(layer)
    const examples = `use${pascal}…, ${pascal}…, ${pascal[0].toLowerCase()}${pascal.slice(1)}…, ${splitByCase(layer).join('_').toUpperCase()}_…`

    function check(node, name) {
      if (!hasLayerPrefix(name, layer)) context.report({ node, messageId: 'unprefixed', data: { name, layer, examples } })
    }

    return {
      ExportNamedDeclaration(node) {
        const declaration = node.declaration
        if (declaration?.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) for (const id of bindingIdentifiers(declarator.id)) check(id, id.name)
        }
        else if (declaration?.id) {
          check(declaration.id, declaration.id.name)
        }
        for (const specifier of node.specifiers) {
          const name = specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value
          if (name === 'default') check(specifier, defaultExportName(context.filename))
          else check(specifier.exported, name)
        }
      },
      ExportDefaultDeclaration(node) {
        check(node, defaultExportName(context.filename))
      },
      ExportAllDeclaration(node) {
        context.report({ node, messageId: 'exportAll', data: { layer } })
      },
    }
  },
}

const layerPages = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep a capability layer\'s pages under its project-scoped route', url: DOCS },
    schema: [],
    messages: {
      // The URL prefix comes from the product configuration, which plain Node cannot load, so the message names it generically.
      outside: `Pages of the \`{{layer}}\` capability layer must live under app/pages/${PROJECT_PAGES.join('/')}/{{layer}}/ (route /<scope prefix>/:project/{{layer}}/…). See ${DOCS}.`,
    },
  },
  create(context) {
    const { project, layer } = layerOf(context)
    if (!layer || kindOf(layer) !== 'capability') return {}
    const rel = relative(join(layerRoot(project, layer), 'app/pages'), context.filename)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return {}
    const parts = rel.split(sep)
    const inProject = parts[0] === PROJECT_PAGES[0] && parts[1] === PROJECT_PAGES[1]
    const scoped = inProject
      && (parts[2] === layer ? parts.length > 3 : parts.length === 3 && basename(parts[2], extname(parts[2])) === layer)
    const home = inProject && layer === PROJECT_HOME_LAYER && parts.length === 3 && parts[2] === 'index.vue'
    if (scoped || home) return {}
    return {
      Program(program) {
        context.report({ node: program, messageId: 'outside', data: { layer } })
      },
    }
  },
}

const STYLESHEET = /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)$/
// Nuxt UI configures the colour-mode module with no class suffix, so these classes sit on <html>.
const COLOUR_MODE_CLASSES = ['dark', 'light']
// Tailwind's own cascade layers; a layer may still name a cascade layer of its own.
const TAILWIND_LAYERS = new Set(['theme', 'base', 'components', 'utilities'])
const TAILWIND_AT_RULES = new Set(['theme', 'utility', 'custom-variant', 'tailwind', 'plugin', 'config', 'source'])

/** A `?url` or `?raw` import yields a string, not a sheet in the document. */
function importsStylesheet(source) {
  const [path, query] = source.split('?', 2)
  return STYLESHEET.test(path) && !['url', 'raw'].includes(query ?? '')
}

/**
 * The preludes (`selector {`, `@media … {`) and statements (`prop: value;`, `@import …;`) of a style block in
 * document order with their offsets, skipping comments, strings and anything in parentheses. Nesting (Sass, native)
 * falls out, because every brace opens or closes a block; no CSS parser is needed for what the rule looks at.
 */
function cssParts(source) {
  const css = blankComments(source)
  const parts = []
  let start = 0
  let parens = 0
  const part = (kind, end) => {
    const text = css.slice(start, end)
    if (text.trim()) parts.push({ kind, text, offset: start })
    start = end + 1
  }
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '"' || ch === '\'') i = stringEnd(css, i)
    else if (ch === '(') parens++
    else if (ch === ')') parens = Math.max(0, parens - 1)
    else if (parens > 0) continue
    else if (ch === '{') part('prelude', i)
    else if (ch === ';' || ch === '}') part('statement', i)
  }
  part('statement', css.length)
  return parts
}

function stringEnd(css, open) {
  let i = open + 1
  for (; i < css.length && css[i] !== css[open] && css[i] !== '\n'; i++) if (css[i] === '\\') i++
  return i
}

/**
 * Block and line comments replaced by spaces, so offsets into the original text survive; strings are left alone, and
 * `//` inside parentheses is an unquoted url(http://…), not a Sass comment.
 */
function blankComments(css) {
  let out = ''
  let parens = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '"' || ch === '\'') {
      const end = stringEnd(css, i)
      out += css.slice(i, end + 1)
      i = end
    }
    else if (ch === '(' || ch === ')') {
      parens = Math.max(0, parens + (ch === '(' ? 1 : -1))
      out += ch
    }
    else if (ch === '/' && (css[i + 1] === '*' || (css[i + 1] === '/' && parens === 0))) {
      const close = css[i + 1] === '*' ? css.indexOf('*/', i + 2) : css.indexOf('\n', i)
      const end = close < 0 ? css.length : css[i + 1] === '*' ? close + 2 : close
      out += css.slice(i, end).replace(/[^\n]/g, ' ')
      i = end - 1
    }
    else out += ch
  }
  return out
}

/** Selector text with quoted strings and attribute selectors blanked, so `[title="body"]` is not a body selector. */
const bareSelector = selector => selector.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\[[^\]]*\]/g, '[]')

function rootTarget(selector) {
  const bare = bareSelector(selector)
  if (/(?<![\w-]):root(?![\w-])/.test(bare)) return ':root'
  const element = /(?<![\w.#:-])(html|body)(?![\w-])/.exec(bare)
  if (element) return element[1]
  const mode = new RegExp(`\\.(${COLOUR_MODE_CLASSES.join('|')})(?![\\w-])`).exec(bare)
  return mode ? `.${mode[1]}` : undefined
}

/** The file an `@import url("x.css") layer(base)` or `@import 'x.css'` names. */
function importTarget(prelude) {
  return /^\s*(?:url\()?\s*["']?([^"')\s]+)/.exec(prelude)?.[1] ?? prelude.trim()
}

function tailwindForm(atRule, prelude) {
  if (TAILWIND_AT_RULES.has(atRule)) return `@${atRule}`
  if (atRule !== 'layer') return undefined
  const named = prelude.split(',').map(name => name.trim()).find(name => TAILWIND_LAYERS.has(name))
  return named ? `@layer ${named}` : undefined
}

function propertyName(property) {
  if (property.type !== 'Property') return undefined
  return property.key.type === 'Identifier' && !property.computed ? property.key.name : staticString(property.key)
}

/** The object literal a config file exports, through `defineNuxtConfig(…)`, `satisfies`/`as` and a top-level const. */
function configObject(program) {
  let node = program.body.find(statement => statement.type === 'ExportDefaultDeclaration')?.declaration
  const seen = new Set()
  while (node && !seen.has(node)) {
    seen.add(node)
    if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(node.type)) node = node.expression
    else if (node.type === 'CallExpression') node = node.arguments[0]
    else if (node.type === 'Identifier') node = topLevelInit(program, node.name)
    else break
  }
  return node?.type === 'ObjectExpression' ? node : undefined
}

function topLevelInit(program, name) {
  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration') continue
    const declarator = declaration.declarations.find(d => d.id.type === 'Identifier' && d.id.name === name)
    if (declarator) return declarator.init
  }
  return undefined
}

const ENV_OVERRIDES = new Set(['$production', '$development', '$test'])

/** A nuxt.config's top level and its environment overrides, each of which may set `css`. */
function nuxtConfigLevels(config) {
  const levels = [config]
  for (const property of config.properties) {
    const name = propertyName(property)
    if (property.value?.type !== 'ObjectExpression') continue
    if (ENV_OVERRIDES.has(name)) levels.push(property.value)
    else if (name === '$env') levels.push(...property.value.properties.map(env => env.value).filter(value => value?.type === 'ObjectExpression'))
  }
  return levels
}

const layerStyling = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep a layer\'s styling inside the markup it renders: scoped blocks, its own prefixed variables, no stylesheets or Nuxt UI defaults', url: DOCS },
    schema: [],
    messages: {
      unscoped: `A style block in the \`{{layer}}\` layer must be \`scoped\` or \`module\`; an unscoped block styles the whole app. See ${DOCS}.`,
      sheet: `The \`{{layer}}\` layer may not load the stylesheet '{{source}}': an imported sheet is global. Style the layer's own markup from scoped blocks. See ${DOCS}.`,
      global: `\`{{selector}}\` in the \`{{layer}}\` layer escapes its scope with {{form}}. See ${DOCS}.`,
      root: `\`{{selector}}\` in the \`{{layer}}\` layer selects \`{{target}}\` (the document root, html, body or the colour-mode class), which belongs to the shell and the product. See ${DOCS}.`,
      variable: `\`{{property}}\` is assigned in the \`{{layer}}\` layer; a layer sets only its own custom properties (\`--{{layer}}-…\`) on its own root elements, never a shell (--ui-*, --app-*) or Tailwind theme variable. See ${DOCS}.`,
      tailwind: `\`{{form}}\` in the \`{{layer}}\` layer declares Tailwind theme, base-layer or utility CSS, which is global. See ${DOCS}.`,
      configSheet: `The \`{{layer}}\` layer may not register the stylesheet '{{source}}' through its nuxt.config \`css\` option: a registered sheet is global. Style the layer's own markup from scoped blocks. See ${DOCS}.`,
      appConfigUi: `The \`{{layer}}\` layer may not set \`ui\` in its app config: it rewrites Nuxt UI's component defaults for the whole app. Pass a per-instance \`ui\` prop or wrap the component under the layer's prefix. See ${DOCS}.`,
    },
  },
  create(context) {
    const { project, layer } = layerOf(context)
    if (!layer) return {}
    const sourceCode = context.sourceCode
    const rel = relative(layerRoot(project, layer), context.filename).split(sep).join('/')
    const ownProperty = new RegExp(`^--${layer}(?:-|$)`)

    function checkImport(node) {
      const source = staticString(node)
      if (source !== undefined && importsStylesheet(source)) context.report({ node, messageId: 'sheet', data: { layer, source } })
    }

    function report(offset, length, messageId, data) {
      const loc = { start: sourceCode.getLocFromIndex(offset), end: sourceCode.getLocFromIndex(offset + length) }
      context.report({ loc, messageId, data: { layer, ...data } })
    }

    function checkCss(text, base) {
      for (const { kind, text: raw, offset } of cssParts(text)) {
        const lead = raw.length - raw.trimStart().length
        const part = raw.trim()
        const at = offset + lead
        const atRule = /^@([\w-]+)/.exec(part)
        if (atRule) {
          const form = kind === 'prelude' ? tailwindForm(atRule[1], part.slice(atRule[0].length)) : TAILWIND_AT_RULES.has(atRule[1]) ? atRule[0] : undefined
          if (form) report(base + at, part.length, 'tailwind', { form })
          else if (kind === 'statement' && atRule[1] === 'import') report(base + at, part.length, 'sheet', { source: importTarget(part.slice(atRule[0].length)) })
          continue
        }
        if (kind === 'prelude') {
          const global = /(?<![\w-])(::v-global|:global)(?![\w-])/.exec(bareSelector(part))
          if (global) report(base + at, part.length, 'global', { selector: part, form: global[1] })
          const target = rootTarget(part)
          if (target) report(base + at, part.length, 'root', { selector: part, target })
          continue
        }
        const property = /^(--[\w-]+)\s*:/.exec(part)
        if (property && !ownProperty.test(property[1])) report(base + at, property[1].length, 'variable', { property: property[1] })
      }
    }

    function checkStyleBlocks() {
      const fragment = sourceCode.parserServices?.getDocumentFragment?.()
      for (const element of fragment?.children ?? []) {
        if (element.type !== 'VElement' || element.name !== 'style') continue
        const attributes = new Map(element.startTag.attributes.filter(attr => !attr.directive).map(attr => [attr.key.name, attr.value?.value ?? '']))
        if (attributes.has('src')) context.report({ node: element.startTag, messageId: 'sheet', data: { layer, source: attributes.get('src') } })
        if (!attributes.has('scoped') && !attributes.has('module')) context.report({ node: element.startTag, messageId: 'unscoped', data: { layer } })
        for (const child of element.children) if (child.type === 'VText') checkCss(child.value, child.range[0])
      }
    }

    function checkNuxtConfig(program) {
      const config = configObject(program)
      for (const level of config ? nuxtConfigLevels(config) : []) {
        const css = level.properties.find(property => propertyName(property) === 'css')
        if (!css) continue
        const sheets = css.value.type === 'ArrayExpression' ? css.value.elements.filter(Boolean) : [css.value]
        for (const sheet of sheets) context.report({ node: sheet, messageId: 'configSheet', data: { layer, source: staticString(sheet) ?? sourceCode.getText(sheet) } })
      }
    }

    function checkAppConfig(program) {
      const ui = configObject(program)?.properties.find(property => propertyName(property) === 'ui')
      if (ui) context.report({ node: ui.key, messageId: 'appConfigUi', data: { layer } })
    }

    const checkConfig = NUXT_CONFIG.test(rel) ? checkNuxtConfig : APP_CONFIG.test(rel) ? checkAppConfig : undefined
    return {
      ...moduleSources(checkImport),
      'Program:exit'(program) {
        checkStyleBlocks()
        checkConfig?.(program)
      },
    }
  },
}

const plugin = {
  meta: { name: 'cm-layers' },
  rules: {
    'no-cross-layer-import': noCrossLayerImport,
    'no-cross-layer-auto-import': noCrossLayerAutoImport,
    'no-platform-package-import': noPlatformPackageImport,
    'layer-prefix': layerPrefixRule,
    'layer-pages': layerPages,
    'layer-styling': layerStyling,
  },
}

export default plugin

/**
 * The config block that enables every rule as an error for an app that extends the shell, or for the shell itself.
 * @param {string} configUrl the eslint.config's `import.meta.url`; its directory is the linted root
 */
export function layerBoundaries(configUrl) {
  return {
    name: 'cm/layer-boundaries',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    plugins: { 'cm-layers': plugin },
    settings: { 'cm-layers': { root: fileURLToPath(new URL('.', configUrl)) } },
    rules: {
      'cm-layers/no-cross-layer-import': 'error',
      'cm-layers/no-cross-layer-auto-import': 'error',
      'cm-layers/no-platform-package-import': 'error',
      'cm-layers/layer-prefix': 'error',
      'cm-layers/layer-pages': 'error',
      'cm-layers/layer-styling': 'error',
    },
  }
}

/**
 * The whole lint config of a layer package (its package.json declares `webLayer`): Nuxt's rules for its layer files
 * (not its daemon source), the given configs (the platform-config preset), and every boundary rule as the apps
 * extending the layer see it.
 * @param {string} configUrl the package's eslint.config `import.meta.url`
 * @param {...object} configs
 */
export async function layerPackageConfig(configUrl, ...configs) {
  const root = fileURLToPath(new URL('.', configUrl))
  if (typeof readJson(join(root, 'package.json'))?.webLayer !== 'string') {
    throw new Error(`layerPackageConfig: ${join(root, 'package.json')} must declare "webLayer": "<id>".`)
  }
  const nuxt = await createConfigForNuxt({
    features: { standalone: true },
    dirs: { root: ['.'], src: ['app'], componentsPrefixed: ['app/components'] },
  }).toConfigs()
  const globalIgnore = config => Object.keys(config).every(key => key === 'name' || key === 'ignores')
  return [
    ...nuxt.map(config => (globalIgnore(config) ? config : { ...config, ignores: [...(config.ignores ?? []), `${DAEMON_SOURCE}/**`] })),
    ...configs,
    layerBoundaries(configUrl),
  ]
}
