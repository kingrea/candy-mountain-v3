import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('../fixtures/layered-app', import.meta.url))
// The fixture app's shell: core plus the chat and overview layers, as @candy-mountain/platform-web holds them.
const platformRoot = fileURLToPath(new URL('../fixtures/platform-layer', import.meta.url))
// Package layers outside the app root, linked from the fixture app's package.json and listed in test/fixtures/pnpm-workspace.yaml.
const packageRoot = fileURLToPath(new URL('../fixtures/delta-layer', import.meta.url))
const secondPackageRoot = fileURLToPath(new URL('../fixtures/epsilon-layer', import.meta.url))

interface Finding {
  rule: string
  message: string
}

let results: Map<string, Finding[]>

/** Lints `files` with `root` as the linted root, the way the pipeline lints that package. */
async function lintFixture(root: string, files: string[]): Promise<Map<string, Finding[]>> {
  const eslint = new ESLint({
    cwd: webRoot,
    ignore: false,
    overrideConfig: { settings: { 'cm-layers': { root, platform: platformRoot } } },
  })
  const lint = await eslint.lintFiles(files)
  return new Map(lint.map(result => [
    relative(fixtureRoot, result.filePath).replaceAll('\\', '/'),
    result.messages
      .filter(message => message.fatal || message.ruleId?.startsWith('cm-layers/'))
      .map(message => ({ rule: message.ruleId ?? 'fatal', message: message.message })),
  ]))
}

function findings(file: string): Finding[] {
  const found = results.get(file)
  if (!found) throw new Error(`fixture ${file} was not linted`)
  return found
}

beforeAll(async () => {
  results = await lintFixture(fixtureRoot, [fixtureRoot, platformRoot, packageRoot, secondPackageRoot])
}, 60_000)

describe('layer boundary lint', () => {
  it.each([
    '../platform-layer/app/components/CoreBadge.vue',
    '../platform-layer/app/composables/useCoreThing.ts',
    '../platform-layer/app/utils/core.ts',
    '../platform-layer/layers/chat/nuxt.config.ts',
    '../platform-layer/layers/chat/app/components/Panel.vue',
    '../platform-layer/layers/chat/app/composables/useChatThread.ts',
    'layers/alpha/nuxt.config.ts',
    'layers/alpha/app/components/Card.vue',
    'layers/alpha/app/composables/useAlpha.ts',
    'layers/alpha/app/utils/alpha.ts',
    'layers/alpha/app/pages/p/[project]/alpha/index.vue',
    '../platform-layer/layers/overview/nuxt.config.ts',
    '../platform-layer/layers/overview/app/pages/p/[project]/index.vue',
  ])('passes %s, which only uses core, chat and its own layer, wherever the shell holds them', (file) => {
    expect(findings(file)).toEqual([])
  })

  it.each([
    'layers/gadget/nuxt.config.ts',
    'layers/gadget/app/components/Panel.vue',
    'layers/gadget/app/plugins/gadget.ts',
  ])('passes %s in a plugin-type layer, which has no pages and registers through core from a Nuxt plugin', (file) => {
    expect(findings(file)).toEqual([])
  })

  it('rejects a capability layer importing from another capability layer', () => {
    expect(findings('layers/beta/app/components/UsesAlpha.vue')).toEqual([
      {
        rule: 'cm-layers/no-cross-layer-auto-import',
        message: '<AlphaCard> belongs to the `alpha` capability layer; the `beta` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
      },
      {
        rule: 'cm-layers/no-cross-layer-auto-import',
        message: '\'alphaFormat\' is auto-imported from the `alpha` capability layer; the `beta` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
      },
      {
        rule: 'cm-layers/no-cross-layer-import',
        message: 'The `beta` capability layer may not import \'useAlpha\' from #imports: it belongs to the `alpha` capability layer. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
      },
      {
        rule: 'cm-layers/no-cross-layer-import',
        message: 'The `beta` capability layer may not import from the `alpha` capability layer (\'#layers/alpha/app/composables/useAlpha\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
      },
    ])
  })

  it('rejects the chat layer and core, inside the platform package, depending on a capability layer', () => {
    expect(findings('../platform-layer/layers/chat/app/components/UsesAlpha.vue').map(f => f.message)).toEqual([
      'The shared `chat` layer may not import from the `alpha` capability layer (\'#layers/alpha/app/composables/useAlpha\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
    ])
    expect(findings('../platform-layer/app/components/CoreUsesAlpha.vue').map(f => f.message)).toEqual([
      '<AlphaCard> belongs to the `alpha` capability layer; the core app may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
    ])
  })

  it('rejects auto-imports without the layer prefix', () => {
    expect(findings('layers/beta/app/composables/helpers.ts')).toEqual([
      {
        rule: 'cm-layers/layer-prefix',
        message: '\'PAGE_SIZE\' is auto-imported from the `beta` layer and must carry its prefix (useBeta…, Beta…, beta…, BETA_…). See packages/platform-web/README.md.',
      },
      {
        rule: 'cm-layers/layer-prefix',
        message: '\'formatRow\' is auto-imported from the `beta` layer and must carry its prefix (useBeta…, Beta…, beta…, BETA_…). See packages/platform-web/README.md.',
      },
    ])
    expect(findings('layers/beta/nuxt.config.ts').map(f => f.message)).toEqual([
      'Layer `beta` must register its components with `components: [{ path: \'./components\', prefix: \'Beta\' }]`. See packages/platform-web/README.md.',
    ])
  })

  it('rejects capability pages outside the layer\'s project-scoped route', () => {
    expect(findings('layers/beta/app/pages/beta.vue').map(f => f.message)).toEqual([
      'Pages of the `beta` capability layer must live under app/pages/p/[project]/beta/ (route /<scope prefix>/:project/beta/…). See packages/platform-web/README.md.',
    ])
  })

  it('lets only the overview layer own the project home', () => {
    expect(findings('layers/beta/app/pages/p/[project]/index.vue').map(f => f.message)).toEqual([
      'Pages of the `beta` capability layer must live under app/pages/p/[project]/beta/ (route /<scope prefix>/:project/beta/…). See packages/platform-web/README.md.',
    ])
  })

  describe('with a package layer', () => {
    it.each([
      '../delta-layer/nuxt.config.ts',
      '../delta-layer/app/components/Widget.vue',
      '../delta-layer/app/composables/useDelta.ts',
      '../delta-layer/app/utils/delta.ts',
      '../delta-layer/app/pages/p/[project]/delta/index.vue',
    ])('passes %s, which only uses core, chat and its own package', (file) => {
      expect(findings(file)).toEqual([])
    })

    it('rejects a directory layer using the package layer by auto-import, alias and package name', () => {
      expect(findings('layers/beta/app/components/UsesDelta.vue')).toEqual([
        {
          rule: 'cm-layers/no-cross-layer-auto-import',
          message: '<DeltaWidget> belongs to the `delta` capability layer; the `beta` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
        },
        {
          rule: 'cm-layers/no-cross-layer-auto-import',
          message: '\'deltaFormat\' is auto-imported from the `delta` capability layer; the `beta` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
        },
        {
          rule: 'cm-layers/no-cross-layer-import',
          message: 'The `beta` capability layer may not import \'useDelta\' from #imports: it belongs to the `delta` capability layer. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
        },
        {
          rule: 'cm-layers/no-cross-layer-import',
          message: 'The `beta` capability layer may not import from the `delta` capability layer (\'#layers/delta/app/composables/useDelta\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
        },
        {
          rule: 'cm-layers/no-cross-layer-import',
          message: 'The `beta` capability layer may not import from the `delta` capability layer (\'@fixture/delta/app/utils/delta\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
        },
      ])
    })

    it('rejects the package layer using a directory layer, and core using the package layer', () => {
      expect(findings('../delta-layer/app/components/UsesAlpha.vue').map(f => f.message)).toEqual([
        '<AlphaCard> belongs to the `alpha` capability layer; the `delta` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
        'The `delta` capability layer may not import from the `alpha` capability layer (\'#layers/alpha/app/composables/useAlpha\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
      ])
      expect(findings('../platform-layer/app/components/CoreUsesDelta.vue').map(f => f.message)).toEqual([
        '<LazyDeltaWidget> belongs to the `delta` capability layer; the core app may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
      ])
    })

    it('requires the prefix on the package layer\'s auto-imports and keeps its pages project scoped', () => {
      expect(findings('../delta-layer/app/utils/helpers.ts').map(f => f.message)).toEqual([
        '\'formatCell\' is auto-imported from the `delta` layer and must carry its prefix (useDelta…, Delta…, delta…, DELTA_…). See packages/platform-web/README.md.',
      ])
      expect(findings('../delta-layer/app/pages/delta.vue').map(f => f.message)).toEqual([
        'Pages of the `delta` capability layer must live under app/pages/p/[project]/delta/ (route /<scope prefix>/:project/delta/…). See packages/platform-web/README.md.',
      ])
    })
  })
  describe('with two layer packages', () => {
    it.each([
      '../epsilon-layer/nuxt.config.ts',
      '../epsilon-layer/vitest.config.ts',
      '../epsilon-layer/app/components/Gauge.vue',
      '../epsilon-layer/app/composables/useEpsilon.ts',
      '../epsilon-layer/app/utils/epsilon.ts',
      '../epsilon-layer/app/pages/p/[project]/epsilon/index.vue',
      '../epsilon-layer/test/unit/epsilon.test.ts',
    ])('passes %s, which uses core through auto-imports and #layers/platform-web, chat and its own package', (file) => {
      expect(findings(file)).toEqual([])
    })

    it.each([
      '../epsilon-layer/src/index.ts',
      '../epsilon-layer/src/wire.ts',
    ])('leaves %s, the package\'s daemon source, to the daemon rules even where it imports a declared package', (file) => {
      expect(findings(file)).toEqual([])
    })

    it('rejects a layer package using another layer package by auto-import, package name and path', () => {
      expect(findings('../epsilon-layer/app/components/UsesDelta.vue')).toEqual([
        {
          rule: 'cm-layers/no-cross-layer-auto-import',
          message: '<DeltaWidget> belongs to the `delta` capability layer; the `epsilon` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
        },
        {
          rule: 'cm-layers/no-cross-layer-auto-import',
          message: '\'deltaFormat\' is auto-imported from the `delta` capability layer; the `epsilon` capability layer may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
        },
        {
          rule: 'cm-layers/no-cross-layer-import',
          message: 'The `epsilon` capability layer may not import from the `delta` capability layer (\'@fixture/delta\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
        },
        {
          rule: 'cm-layers/no-cross-layer-import',
          message: 'The `epsilon` capability layer may not import from the `delta` capability layer (\'@fixture/delta/app/utils/delta\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
        },
        {
          rule: 'cm-layers/no-cross-layer-import',
          message: 'The `epsilon` capability layer may not import from the `delta` capability layer (\'../../../delta-layer/app/utils/delta\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/platform-sdk.',
        },
      ])
    })

    it('rejects a layer package importing the platform package by name or path instead of its aliases', () => {
      const advice = 'Reach core through its auto-imports, #imports, #components or #layers/platform-web/…; wire types belong in @candy-mountain/platform-sdk.'
      expect(findings('../epsilon-layer/app/utils/platform.ts')).toEqual([
        {
          rule: 'cm-layers/no-platform-package-import',
          message: `The \`epsilon\` capability layer may not import @fixture/platform-web by package name or path ('@fixture/platform-web/app/utils/core'). ${advice}`,
        },
        {
          rule: 'cm-layers/no-platform-package-import',
          message: `The \`epsilon\` capability layer may not import @fixture/platform-web by package name or path ('../../../platform-layer/app/utils/core'). ${advice}`,
        },
      ])
    })

    it.each([
      ['delta', packageRoot],
      ['epsilon', secondPackageRoot],
    ])('reports the same findings for the %s package linted from its own root as when the app is linted', async (_, root) => {
      const own = await lintFixture(root, [root])
      expect(own.size).toBeGreaterThan(0)
      for (const [file, found] of own) expect({ file, found }).toEqual({ file, found: findings(file) })
    }, 60_000)
  })
})
