/** What a product calls its workspace, in every form the UI prints. */
export interface ScopeLabel {
  singular: string
  plural: string
  singularTitle: string
  pluralTitle: string
}

export interface ProductTheme {
  /** Nuxt UI colour name used as `primary`. */
  primary: string
  /** The same colour as `#rrggbb`, for the theme-color meta and the PWA manifest. */
  hex: string
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
