import type { ProductConfig } from '@candy-mountain/platform-sdk'

/** The shell on its own: the playground, typecheck, lint and the unit tests run the platform with this product and no capability layer. */
export const PLAYGROUND_PRODUCT: Readonly<ProductConfig> = {
  name: 'Platform Playground',
  description: 'The platform shell on its own',
  theme: { primary: 'sky', hex: '#0ea5e9' },
  scope: {
    label: { singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' },
    urlPrefix: 'p',
  },
  capabilities: ['overview', 'platform-agent'],
  modules: [],
  pluginTypes: [],
  layers: ['overview', 'chat'],
}
