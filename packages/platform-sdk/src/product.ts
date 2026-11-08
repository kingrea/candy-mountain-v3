/** What a product calls its workspace, in every form the UI prints. */
export interface ScopeLabel {
  singular: string
  plural: string
  singularTitle: string
  pluralTitle: string
}

/** An icon name as UIcon takes it, or an image URL with optional classes for the `img` element. */
export type IconSource = { name: string } | { src: string, class?: string }

/**
 * Nuxt UI's colour aliases. Each names a Tailwind palette or a colour scale the product's own stylesheet declares;
 * an omitted optional alias keeps Nuxt UI's default.
 */
export interface ProductColors {
  primary: string
  neutral: string
  secondary?: string
  success?: string
  info?: string
  warning?: string
  error?: string
}

export type ColorModePreference = 'light' | 'dark' | 'system'

// Plain JSON only: the shell serialises the theme into a virtual module and the daemon reads it too.
export interface ProductTheme {
  colors: ProductColors
  /** The primary colour as `#rrggbb`, for the theme-color meta and the PWA manifest. */
  hex: string
  /** Shown wherever the shell prints the product name; an image URL is one the distribution serves from its public directory. */
  logo: IconSource
  colorMode: {
    /** The mode a visitor gets before choosing one; `system` follows the operating system. */
    default: ColorModePreference
    /** Whether the user may switch modes; when false the default is the only mode. */
    switchable: boolean
  }
}

// Ids stay plain strings: the daemon and the web shell validate them against
// what they actually register, so adding a capability never edits this package.
// `capabilities` names every daemon definition, service-only ones (slack) included.
export interface ProductConfig {
  name: string
  /** One line for the PWA manifest. */
  description: string
  theme: ProductTheme
  scope: {
    label: ScopeLabel
    /** Single path segment in front of the workspace slug, as in `/p/<slug>`. */
    urlPrefix: string
    /** Single path segment of the page that lists every workspace, as in `/projects`; also its nav entry's id. */
    listPath: string
  }
  capabilities: readonly string[]
  modules: readonly string[]
  pluginTypes: readonly string[]
  layers: readonly string[]
}

/** Ids a product includes only when its apps run from source; a build carries none of them, nor their packages. */
export interface ProductDevelopment {
  capabilities: readonly string[]
  modules: readonly string[]
  pluginTypes: readonly string[]
  layers: readonly string[]
}

/** The configuration a development run boots: the production configuration with the development ids appended to each list. */
export function developmentProductConfig(config: Readonly<ProductConfig>, development: ProductDevelopment): ProductConfig {
  return {
    ...config,
    capabilities: [...config.capabilities, ...development.capabilities],
    modules: [...config.modules, ...development.modules],
    pluginTypes: [...config.pluginTypes, ...development.pluginTypes],
    layers: [...config.layers, ...development.layers],
  }
}
