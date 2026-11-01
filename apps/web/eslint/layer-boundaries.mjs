import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { hasNuxtConfig, packageLayers } from '../layer-list.mjs'
import { SCOPE_PAGES_DIR } from '../scope-routes.mjs'

export const SHARED_LAYER = 'chat'

// The one capability whose manifest view path is '' owns the project home, app/pages/p/[project]/index.vue.
export const PROJECT_HOME_LAYER = 'overview'

// A layer may always use its own files; packages such as @candy-mountain/shared are never restricted unless they are layer packages.
// A plugin-type layer (no manifest, no pages) is a capability layer here.
export const ALLOWED = {
  core: ['shared'],
  shared: ['core'],
  capability: ['core', 'shared'],
}

const DIRECTIONS = 'Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.'
const DOCS = 'apps/web/layers/README.md'
const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LAYER_ID = /^[a-z][a-z\d]*(?:-[a-z\d]+)*$/
const PROJECT_PAGES = [SCOPE_PAGES_DIR, '[project]']

// Tests point the rules at a fixture app instead of apps/web.
function webRoot(context) {
  const root = context.settings?.['cm-layers']?.root
  return root ? resolve(root) : DEFAULT_ROOT
}

function inside(dir, file) {
  const rel = relative(dir, file)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

// A short lifetime keeps long-lived editor ESLint servers current as layers change.
function cached(store, root, compute) {
  const now = Date.now()
  const hit = store.get(root)
  if (hit && now - hit.at < 2000) return hit.value
  const value = compute(root)
  store.set(root, { at: now, value })
  return value
}

const packageScans = new Map()
const layerPackages = root => cached(packageScans, root, packageLayers)

function layerRoot(root, layer) {
  return layerPackages(root).get(layer)?.dir ?? join(root, 'layers', layer)
}

/** `core`, a layer name, or null for files outside the web app and its layer packages. */
function ownerOfPath(root, file) {
  for (const [id, { dir }] of layerPackages(root)) if (inside(dir, file)) return id
  const rel = relative(root, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const parts = rel.split(sep)
  if (parts[0] !== 'layers') return 'core'
  if (parts.length < 2 || (parts.length === 2 && extname(parts[1]))) return null
  return parts[1]
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

// Naming follows scule and Nuxt 4.6's component naming so names match what Nuxt registers.

function isUppercase(char = '') {
  if (/\d/.test(char)) return undefined
  return char !== char.toLowerCase()
}

function splitByCase(str) {
  const parts = []
  if (!str) return parts
  let buff = ''
  let previousUpper
  let previousSplitter
  for (const char of str) {
    const isSplitter = ['-', '_', '/', '.'].includes(char)
    if (isSplitter) {
      parts.push(buff)
      buff = ''
      previousUpper = undefined
      continue
    }
    const isUpper = isUppercase(char)
    if (previousSplitter === false) {
      if (previousUpper === false && isUpper === true) {
        parts.push(buff)
        buff = char
        previousUpper = isUpper
        continue
      }
      if (previousUpper === true && isUpper === false && buff.length > 1) {
        const lastChar = buff.at(-1)
        parts.push(buff.slice(0, -1))
        buff = lastChar + char
        previousUpper = isUpper
        continue
      }
    }
    buff += char
    previousUpper = isUpper
    previousSplitter = isSplitter
  }
  parts.push(buff)
  return parts
}

const upperFirst = str => (str ? str[0].toUpperCase() + str.slice(1) : '')
const pascalCase = parts => parts.map(upperFirst).join('')
const camelCase = (str) => {
  const pascal = pascalCase(splitByCase(str))
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : ''
}

export function layerPrefix(layer) {
  return pascalCase(splitByCase(layer))
}

/** True when an auto-imported name identifies its layer: useIssuesBoard, IssuesRow, issuesPath, ISSUES_PAGE_SIZE. */
export function hasLayerPrefix(name, layer) {
  const pascal = layerPrefix(layer)
  const camel = pascal[0].toLowerCase() + pascal.slice(1)
  const screaming = splitByCase(layer).join('_').toUpperCase()
  const bare = name.replace(/^use(?=[A-Z])/, '')
  return new RegExp(`^(?:${pascal}|${camel})(?:$|[A-Z\\d_])`).test(bare) || new RegExp(`^${screaming}(?:$|_)`).test(name)
}

const isGroupingFolder = segment => /^\(.*\)$/.test(segment.trim())

function resolveComponentNameSegments(fileName, prefixParts) {
  const fileNameParts = splitByCase(fileName)
  const fileNamePartsContent = fileNameParts.join('/').toLowerCase()
  const componentPrefixParts = prefixParts.filter(part => !isGroupingFolder(part))
  const componentNameParts = componentPrefixParts.flatMap(p => splitByCase(p))
  let index = componentPrefixParts.length - 1
  const matchedSuffix = []
  while (index >= 0) {
    const prefixPart = componentPrefixParts[index]
    matchedSuffix.unshift(...splitByCase(prefixPart).map(p => p.toLowerCase()))
    const matchedSuffixContent = matchedSuffix.join('/')
    if (
      fileNamePartsContent === matchedSuffixContent
      || fileNamePartsContent.startsWith(matchedSuffixContent + '/')
      || (prefixPart.toLowerCase() === fileNamePartsContent && componentPrefixParts[index + 1] === prefixPart)
    ) {
      componentNameParts.length = index
    }
    index--
  }
  return [...componentNameParts, ...fileNameParts]
}

function componentName(componentsDir, file, prefix) {
  const prefixParts = [...splitByCase(prefix), ...splitByCase(relative(componentsDir, dirname(file)))]
  let fileName = basename(file, extname(file)).replace(/(?:\.(?:client|server))?(?:\.global|\.island)*$/, '')
  if (fileName.toLowerCase() === 'index') fileName = ''
  return pascalCase(resolveComponentNameSegments(fileName.replace(/["']/g, ''), prefixParts).filter(Boolean))
}

/** Template tags and #components imports may be kebab-case and Lazy-prefixed. */
function componentKey(name) {
  return name.replace(/^(?:Lazy|lazy-)/, '').replace(/[-_]/g, '').toLowerCase()
}

const COMPONENT_FILE = /\.(?:vue|[jt]sx?)$/
const NOT_A_COMPONENT = /(?:[-.]?[Mm]ixin\.[jt]sx?|\.d\.[cm]?ts|\.(?:spec|stories|test)\.[jt]sx?)$/
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

function isAutoImportFile(root, layer, file) {
  return AUTO_IMPORT_DIRS.some((dir) => {
    const rel = relative(join(layerRoot(root, layer), dir), file)
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
function registeredLayers(root) {
  const layersDir = join(root, 'layers')
  const packages = layerPackages(root)
  const local = entries(layersDir)
    .filter(entry => entry.isDirectory() && !packages.has(entry.name) && hasNuxtConfig(join(layersDir, entry.name)))
    .map(entry => entry.name)
  return [...local, ...[...packages].filter(([, { dir }]) => hasNuxtConfig(dir)).map(([id]) => id)]
}

function scanLayers(root) {
  const exports = new Map()
  const components = new Map()
  const componentCount = new Map()
  for (const layer of registeredLayers(root)) {
    const base = layerRoot(root, layer)
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
const layerIndex = root => cached(scans, root, scanLayers)

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
function resolveSource(root, source, filename) {
  if (source.startsWith('.')) return resolve(dirname(filename), source)
  const layer = /^#layers\/([^/]+)(\/.*)?$/.exec(source)
  if (layer) return join(layerRoot(root, layer[1]), layer[2] ?? '')
  // Nuxt's localLayerAliases can point ~/ at the layer's own app/ at build time, but typecheck always means the core app.
  if (/^[~@]\//.test(source)) return join(root, 'app', source.slice(2))
  if (/^(?:~~|@@)\//.test(source)) return join(root, source.slice(3))
  if (isAbsolute(source)) return source
  for (const { name, dir } of layerPackages(root).values()) {
    if (source === name || source.startsWith(`${name}/`)) return join(dir, source.slice(name.length))
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
  const root = webRoot(context)
  const owner = ownerOfPath(root, context.filename)
  return { root, owner, layer: owner && owner !== 'core' ? owner : null }
}

const noCrossLayerImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid explicit imports that cross a web layer boundary', url: DOCS },
    schema: [],
    messages: {
      forbidden: '{{from}} may not import from {{to}} (\'{{source}}\'). ' + DIRECTIONS + ' Shared wire types belong in @candy-mountain/shared.',
      forbiddenName: '{{from}} may not import \'{{name}}\' from {{source}}: it belongs to {{to}}. ' + DIRECTIONS,
    },
  },
  create(context) {
    const { root, owner: from } = layerOf(context)
    if (!from) return {}

    function checkSource(node) {
      const source = staticString(node)
      if (source === undefined) return
      const target = resolveSource(root, source, context.filename)
      const to = target && ownerOfPath(root, target)
      if (!to || isAllowed(from, to)) return
      context.report({ node, messageId: 'forbidden', data: { from: upperFirst(describe(from)), to: describe(to), source } })
    }

    function checkVirtual(node) {
      const source = node.source.value
      const kind = source === '#components' ? 'components' : source === '#imports' ? 'exports' : undefined
      if (!kind) return checkSource(node.source)
      const map = layerIndex(root)[kind]
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') continue
        const name = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
        const owner = forbiddenOwner(from, map.get(kind === 'components' ? componentKey(name) : name))
        if (owner) {
          context.report({ node: specifier, messageId: 'forbiddenName', data: { from: upperFirst(describe(from)), to: describe(owner), name, source } })
        }
      }
    }

    return {
      ImportDeclaration: checkVirtual,
      ExportNamedDeclaration: node => node.source && checkSource(node.source),
      ExportAllDeclaration: node => checkSource(node.source),
      ImportExpression: node => checkSource(node.source),
      TSImportType: node => checkSource(node.source ?? node.argument?.literal),
      CallExpression(node) {
        const name = calleeName(node.callee)
        if (name === 'require' || (name?.startsWith('vi.') && MODULE_CALLS.has(name.slice(3)))) checkSource(node.arguments[0])
      },
    }
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
    const { root, owner: from } = layerOf(context)
    if (!from) return {}
    const sourceCode = context.sourceCode
    const index = layerIndex(root)

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
    const { root, layer } = layerOf(context)
    if (!layer) return {}
    const rel = relative(layerRoot(root, layer), context.filename)

    if (/^nuxt\.config\.[cm]?[jt]s$/.test(rel)) {
      const prefix = layerPrefix(layer)
      const configured = []
      return {
        Property(node) {
          const key = node.key.type === 'Identifier' ? node.key.name : node.key.value
          if (key === 'prefix' && node.value.type === 'Literal') configured.push(node.value.value)
        },
        'Program:exit'(program) {
          if (!LAYER_ID.test(layer)) context.report({ node: program, messageId: 'layerId', data: { layer } })
          const hasComponents = (layerIndex(root).componentCount.get(layer) ?? 0) > 0
          if (configured.some(p => p !== prefix) || (hasComponents && !configured.includes(prefix)))
            context.report({ node: program, messageId: 'componentsPrefix', data: { layer, prefix } })
        },
      }
    }

    if (!isAutoImportFile(root, layer, context.filename)) return {}
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
    const { root, layer } = layerOf(context)
    if (!layer || kindOf(layer) !== 'capability') return {}
    const rel = relative(join(layerRoot(root, layer), 'app/pages'), context.filename)
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

export default {
  meta: { name: 'cm-layers' },
  rules: {
    'no-cross-layer-import': noCrossLayerImport,
    'no-cross-layer-auto-import': noCrossLayerAutoImport,
    'layer-prefix': layerPrefixRule,
    'layer-pages': layerPages,
  },
}
