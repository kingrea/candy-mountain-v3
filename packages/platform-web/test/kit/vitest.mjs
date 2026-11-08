import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import Unimport from 'unimport/unplugin'
import { PLATFORM_DIR, platformLayers } from '../../layer-list.mjs'
import { COMPONENT_FILE, componentName, layerPrefix, NOT_A_COMPONENT } from '../../naming.mjs'

const KIT_DIR = fileURLToPath(new URL('.', import.meta.url))
// The kit's index.ts imports './layer-manifest', typed by the .d.ts beside it and served by the plugin below.
const MANIFEST_IMPORT = './layer-manifest'
const MANIFEST_ID = '\0platform-web-test:layer'
const COMPONENTS_ID = '#components'
const PRODUCT_MODULE = join(PLATFORM_DIR, 'test/product.ts')
const AUTO_IMPORT_DIRS = ['app/composables', 'app/utils', 'shared/utils']
const UI_PREFIX = 'U'

const NUXT_APP_EXPORTS = [
  'useNuxtApp', 'useRouter', 'useRoute', 'onBeforeRouteLeave', 'onBeforeRouteUpdate', 'navigateTo', 'abortNavigation',
  'defineNuxtPlugin', 'defineNuxtRouteMiddleware', 'definePageMeta', 'useHead', 'useSeoMeta', 'useRequestHeaders', 'useRequestURL',
  'useRuntimeConfig', 'useAppConfig', 'onNuxtReady', 'callOnce', 'defineShortcuts', 'useColorMode', 'prerenderRoutes',
  'createError', 'showError', 'clearError', 'useError', 'useState', 'useCookie',
  'useAsyncData', 'useLazyAsyncData', 'useNuxtData', 'refreshNuxtData', 'clearNuxtData', 'createUseFetch', 'useToast', 'useOverlay',
]

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

/** `{ name: file }` for every component Nuxt would register from `<base>/app/components` with that prefix. */
function componentsOf(base, prefix) {
  const dir = join(base, 'app/components')
  const found = {}
  for (const file of walk(dir)) {
    if (COMPONENT_FILE.test(file) && !NOT_A_COMPONENT.test(file)) found[componentName(dir, file, prefix)] = file
  }
  return found
}

function nuxtUiComponentNames() {
  const dir = join(dirname(fileURLToPath(import.meta.resolve('@nuxt/ui'))), 'runtime/components')
  return readdirSync(dir).filter(name => name.endsWith('.vue')).map(name => `${UI_PREFIX}${name.slice(0, -4)}`)
}

function manifestSource(layer) {
  const loaders = Object.entries(layer.components).map(([name, file]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(file)}),`)
  const plugins = layer.plugins.map(file => `  () => import(${JSON.stringify(file)}),`)
  return [
    `export const id = ${JSON.stringify(layer.id)}`,
    `export const prefix = ${JSON.stringify(layer.prefix)}`,
    `export const root = ${JSON.stringify(layer.root)}`,
    `export const platform = ${JSON.stringify(PLATFORM_DIR)}`,
    `export { product } from ${JSON.stringify(PRODUCT_MODULE)}`,
    `export const components = {`, ...loaders, '}',
    `export const plugins = [`, ...plugins, ']',
    `export const uiComponents = ${JSON.stringify(layer.uiComponents)}`,
    '',
  ].join('\n')
}

function componentsSource(layer) {
  const names = [...Object.keys(layer.components), ...layer.uiComponents, ...layer.nuxtComponents]
  return [
    `import { layerComponents } from ${JSON.stringify(join(KIT_DIR, 'index.ts'))}`,
    'const all = layerComponents()',
    ...names.flatMap(name => [`export const ${name} = all.${name}`, `export const Lazy${name} = all.${name}`]),
    '',
  ].join('\n')
}

/** The layer package at `root`, with the shell's components beside its own. */
function describeLayer(root) {
  const manifest = readJson(join(root, 'package.json'))
  if (typeof manifest.webLayer !== 'string') {
    throw new Error(`layerTestConfig: ${join(root, 'package.json')} must declare "webLayer": "<id>".`)
  }
  const id = manifest.webLayer
  const components = { ...componentsOf(PLATFORM_DIR, '') }
  for (const platformLayer of platformLayers()) Object.assign(components, componentsOf(join(PLATFORM_DIR, 'layers', platformLayer), layerPrefix(platformLayer)))
  Object.assign(components, componentsOf(root, layerPrefix(id)))
  const plugins = walk(join(root, 'app/plugins')).filter(file => /\.[mc]?[jt]s$/.test(file) && !file.endsWith('.d.ts')).sort()
  return { id, prefix: layerPrefix(id), root, components, plugins, uiComponents: nuxtUiComponentNames(), nuxtComponents: NUXT_COMPONENTS }
}

const NUXT_COMPONENTS = ['NuxtLink', 'ClientOnly', 'NuxtLayout', 'NuxtErrorBoundary', 'ColorScheme', 'NuxtPage', 'NuxtLoadingIndicator', 'NuxtRouteAnnouncer', 'DevOnly', 'NuxtImg', 'NuxtPicture', 'Icon']

function autoImportDirs(base) {
  return AUTO_IMPORT_DIRS.map(dir => join(base, dir)).filter(dir => existsSync(dir))
}

/**
 * The vitest config a layer package merges into its own so its tests can render pages through
 * `@candy-mountain/platform-web/test`: Vue SFC compilation, the shell's and the layer's auto-imports, the `#layers`,
 * `#imports` and `#components` aliases, and the layer manifest the test entry reads. Tests that render set
 * `// @vitest-environment happy-dom` at their top; the package's other tests keep the node environment.
 * @param {string} configUrl the layer package's `vitest.config` `import.meta.url`; its directory is the layer root
 * @returns {import('vitest/config').ViteUserConfig}
 */
export function layerTestConfig(configUrl) {
  const root = fileURLToPath(new URL('.', configUrl)).replace(/[\\/]$/, '')
  const layer = describeLayer(root)
  const platformDirs = [PLATFORM_DIR, ...platformLayers().map(id => join(PLATFORM_DIR, 'layers', id))]
  const dirs = [...platformDirs, root].flatMap(autoImportDirs)

  const unimport = Unimport.vite({
    presets: ['vue'],
    imports: [
      ...NUXT_APP_EXPORTS.map(name => ({ name, from: join(KIT_DIR, 'nuxt-app.ts') })),
      // Over Vue's, so the kit sees a lazily registered card load.
      { name: 'defineAsyncComponent', from: join(KIT_DIR, 'nuxt-app.ts'), priority: 2 },
    ],
    dirs,
    dirsScanOptions: { types: false, filePatterns: ['*.{ts,js,mjs,mts}', '*/index.{ts,js,mjs,mts}'] },
    virtualImports: ['#imports'],
    addons: { vueTemplate: true },
    // Pages, components and the auto-imported files themselves; a test imports what it needs by name.
    include: [/\.vue(?:\?.*)?$/, /[\\/](?:app|shared)[\\/].*\.[mc]?[jt]s$/],
    exclude: [/node_modules/, /\.(?:test|spec)\.[mc]?[jt]sx?$/],
    dts: false,
  })

  const manifestPlugin = {
    name: 'platform-web-test:layer',
    resolveId(id, importer) {
      if (id === MANIFEST_IMPORT && importer && dirname(importer) === KIT_DIR.replace(/[\\/]$/, '')) return MANIFEST_ID
      return id === COMPONENTS_ID ? `\0${id}` : undefined
    },
    load(id) {
      if (id === MANIFEST_ID) return manifestSource(layer)
      if (id === `\0${COMPONENTS_ID}`) return componentsSource(layer)
      return undefined
    },
  }

  return {
    plugins: [vue(), { ...unimport, enforce: 'post' }, manifestPlugin],
    resolve: {
      alias: {
        '#platform-web/product': PRODUCT_MODULE,
        '#layers/platform-web': PLATFORM_DIR,
        ...Object.fromEntries(platformLayers().map(id => [`#layers/${id}`, join(PLATFORM_DIR, 'layers', id)])),
        [`#layers/${layer.id}`]: root,
        '~~': PLATFORM_DIR,
        '@@': PLATFORM_DIR,
        '~': join(PLATFORM_DIR, 'app'),
        '@': join(PLATFORM_DIR, 'app'),
      },
    },
  }
}
