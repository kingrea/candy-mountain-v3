// Layers write scoped pages under app/pages/p/ whatever the product's prefix, so changing it moves no file.
export const SCOPE_PAGES_DIR = 'p'
// Likewise the workspace list is app/pages/projects.vue whatever the product's list path.
export const SCOPE_LIST_PAGE = 'projects'

const URL_PREFIX = /^[a-z\d]+(?:-[a-z\d]+)*$/

/**
 * Moves the routes Nuxt generated from app/pages/p/ to `/<prefix>/`, in place; route names keep the directory's.
 * @param {{ path: string }[]} pages
 * @param {string} prefix
 */
export function scopeRoutes(pages, prefix) {
  if (!URL_PREFIX.test(prefix)) throw new Error(`Scope URL prefix "${prefix}" must be one lowercase path segment.`)
  if (prefix === SCOPE_PAGES_DIR) return
  const from = `/${SCOPE_PAGES_DIR}`
  for (const page of pages) {
    if (page.path === from || page.path.startsWith(`${from}/`)) page.path = `/${prefix}${page.path.slice(from.length)}`
  }
}

/**
 * Moves the route Nuxt generated from app/pages/projects.vue to `/<listPath>`, in place; its name stays the file's.
 * @param {{ path: string }[]} pages
 * @param {string} listPath
 */
export function scopeListRoute(pages, listPath) {
  if (!URL_PREFIX.test(listPath)) throw new Error(`Scope list path "${listPath}" must be one lowercase path segment.`)
  const page = pages.find(candidate => candidate.path === `/${SCOPE_LIST_PAGE}`)
  if (page) page.path = `/${listPath}`
}
