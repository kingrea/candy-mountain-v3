import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('../fixtures/layered-app', import.meta.url))

interface Finding {
  rule: string
  message: string
}

let results: Map<string, Finding[]>

async function lintFixture(): Promise<Map<string, Finding[]>> {
  const eslint = new ESLint({
    cwd: webRoot,
    ignore: false,
    overrideConfig: { settings: { 'cm-layers': { root: fixtureRoot } } },
  })
  const lint = await eslint.lintFiles([fixtureRoot])
  return new Map(lint.map(result => [
    result.filePath.slice(fixtureRoot.length + 1).replaceAll('\\', '/'),
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
  results = await lintFixture()
}, 60_000)

describe('layer boundary lint', () => {
  it.each([
    'app/components/CoreBadge.vue',
    'app/composables/useCoreThing.ts',
    'app/utils/core.ts',
    'layers/chat/nuxt.config.ts',
    'layers/chat/app/components/Panel.vue',
    'layers/chat/app/composables/useChatThread.ts',
    'layers/alpha/nuxt.config.ts',
    'layers/alpha/app/components/Card.vue',
    'layers/alpha/app/composables/useAlpha.ts',
    'layers/alpha/app/utils/alpha.ts',
    'layers/alpha/app/pages/p/[project]/alpha/index.vue',
    'layers/overview/nuxt.config.ts',
    'layers/overview/app/pages/p/[project]/index.vue',
  ])('passes %s, which only uses core, chat and its own layer', (file) => {
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
        message: 'The `beta` capability layer may not import from the `alpha` capability layer (\'#layers/alpha/app/composables/useAlpha\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/shared.',
      },
    ])
  })

  it('rejects the chat layer and core depending on a capability layer', () => {
    expect(findings('layers/chat/app/components/UsesAlpha.vue').map(f => f.message)).toEqual([
      'The shared `chat` layer may not import from the `alpha` capability layer (\'#layers/alpha/app/composables/useAlpha\'). Allowed: capability -> core, capability -> chat, chat -> core, core -> chat. Shared wire types belong in @candy-mountain/shared.',
    ])
    expect(findings('app/components/CoreUsesAlpha.vue').map(f => f.message)).toEqual([
      '<AlphaCard> belongs to the `alpha` capability layer; the core app may not use it. Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.',
    ])
  })

  it('rejects auto-imports without the layer prefix', () => {
    expect(findings('layers/beta/app/composables/helpers.ts')).toEqual([
      {
        rule: 'cm-layers/layer-prefix',
        message: '\'PAGE_SIZE\' is auto-imported from the `beta` layer and must carry its prefix (useBeta…, Beta…, beta…, BETA_…). See apps/web/layers/README.md.',
      },
      {
        rule: 'cm-layers/layer-prefix',
        message: '\'formatRow\' is auto-imported from the `beta` layer and must carry its prefix (useBeta…, Beta…, beta…, BETA_…). See apps/web/layers/README.md.',
      },
    ])
    expect(findings('layers/beta/nuxt.config.ts').map(f => f.message)).toEqual([
      'Layer `beta` must register its components with `components: [{ path: \'./components\', prefix: \'Beta\' }]`. See apps/web/layers/README.md.',
    ])
  })

  it('rejects capability pages outside the layer\'s project-scoped route', () => {
    expect(findings('layers/beta/app/pages/beta.vue').map(f => f.message)).toEqual([
      'Pages of the `beta` capability layer must live under app/pages/p/[project]/beta/ (route /p/:project/beta/…). See apps/web/layers/README.md.',
    ])
  })

  it('lets only the overview layer own the project home', () => {
    expect(findings('layers/beta/app/pages/p/[project]/index.vue').map(f => f.message)).toEqual([
      'Pages of the `beta` capability layer must live under app/pages/p/[project]/beta/ (route /p/:project/beta/…). See apps/web/layers/README.md.',
    ])
  })
})
