import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const CONFIG_EXTENSIONS = ['ts', 'js', 'mjs', 'mts']

/** @param {string} dir */
export function hasNuxtConfig(dir) {
  return CONFIG_EXTENSIONS.some(ext => existsSync(join(dir, `nuxt.config.${ext}`)))
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch {
    return undefined
  }
}

// link: and file: specs resolve without an install, so the lint fixture needs no node_modules.
function dependencyDir(root, name, spec) {
  if (/^(?:link|file):/.test(spec)) {
    const dir = resolve(root, spec.slice(5))
    return existsSync(join(dir, 'package.json')) ? dir : undefined
  }
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * Every dependency of the web app whose package.json declares `"webLayer": "<id>"`, by layer id.
 * @param {string} root
 * @returns {Map<string, { name: string, dir: string }>}
 */
export function packageLayers(root) {
  const manifest = readJson(join(root, 'package.json'))
  const layers = new Map()
  for (const [name, spec] of Object.entries({ ...manifest?.devDependencies, ...manifest?.dependencies })) {
    const dir = dependencyDir(root, name, String(spec))
    const id = dir && readJson(join(dir, 'package.json'))?.webLayer
    if (typeof id === 'string') layers.set(id, { name, dir: realpathSync(dir) })
  }
  return layers
}

/**
 * Nuxt `extends` entries for the listed layer ids, each `layers/<id>` or a `webLayer` package.
 * @param {readonly string[]} ids
 * @param {string} root
 * @returns {[string, { meta: { name: string } }][]}
 */
export function listLayers(ids, root) {
  const packages = packageLayers(root)
  const problems = []
  const entries = []
  for (const id of ids) {
    const local = join(root, 'layers', id)
    const pkg = packages.get(id)
    if (pkg && hasNuxtConfig(local)) problems.push(`${id} (both layers/${id} and package ${pkg.name})`)
    else if (pkg && !hasNuxtConfig(pkg.dir)) problems.push(`${id} (package ${pkg.name} has no nuxt.config)`)
    else if (!pkg && !hasNuxtConfig(local)) problems.push(id)
    // The meta name gives a package layer the same #layers/<id> alias a directory layer gets.
    else entries.push([pkg ? pkg.dir : local, { meta: { name: id } }])
  }
  if (problems.length) {
    throw new Error(
      `Web layers listed by the product configuration could not be resolved: ${problems.join(', ')}. `
      + `Each id needs apps/web/layers/<id>/nuxt.config.ts or a dependency whose package.json has "webLayer": "<id>".`,
    )
  }
  return entries
}

function realDir(path) {
  try {
    return realpathSync(path)
  }
  catch {
    return resolve(path)
  }
}

/**
 * Removes the `layers/<id>` directories Nuxt globbed but the list leaves out, with their aliases.
 * @param {{ _layers: { cwd?: string, config: { rootDir?: string }, meta?: { name?: string } }[], alias: Record<string, string> }} options
 * @param {string} root
 * @param {readonly string[]} ids
 */
export function dropUnlistedLayers(options, root, ids) {
  const listed = new Set(ids)
  const layersDir = join(realDir(root), 'layers')
  for (let i = options._layers.length - 1; i >= 0; i--) {
    const layer = options._layers[i]
    const rel = relative(layersDir, realDir(layer.config.rootDir ?? layer.cwd ?? ''))
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep) || listed.has(rel)) continue
    options._layers.splice(i, 1)
    delete options.alias[`#layers/${layer.meta?.name ?? rel}`]
  }
}

/**
 * Config to spread into defineNuxtConfig so the app registers exactly the listed layers; throws naming any that is missing.
 * @param {readonly string[]} ids
 * @param {string} root
 */
export function layerListConfig(ids, root) {
  return {
    extends: listLayers(ids, root),
    hooks: {
      // Nuxt always globs layers/*; this is the last hook before modules and scanners read _layers.
      async 'modules:before'() {
        const { useNuxt } = await import('nuxt/kit')
        dropUnlistedLayers(useNuxt().options, root, ids)
      },
    },
  }
}
