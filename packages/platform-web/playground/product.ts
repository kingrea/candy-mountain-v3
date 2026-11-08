import type { ProductConfig } from '@candy-mountain/platform-sdk'

/**
 * The shell on its own: the playground, typecheck, lint and the unit tests run the platform with this product and no
 * capability layer. Its theme uses every field, with a primary outside Tailwind's palette that theme.css declares.
 */
export const PLAYGROUND_PRODUCT: Readonly<ProductConfig> = {
  name: 'Platform Playground',
  description: 'The platform shell on its own',
  theme: {
    colors: { primary: 'lagoon', neutral: 'zinc', secondary: 'amber' },
    hex: '#0b9f9f',
    logo: { src: '/logo.svg' },
    colorMode: { default: 'dark', switchable: false },
  },
  scope: {
    label: { singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' },
    urlPrefix: 'p',
    listPath: 'projects',
  },
  capabilities: ['overview', 'platform-agent'],
  modules: [],
  pluginTypes: [],
  layers: ['overview', 'chat'],
}
