import { Marked } from 'marked'

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

/** The URL with a scheme outside http, https and mailto refused; relative and fragment URLs pass. */
export function issuesSafeUrl(href: string): string | null {
  // Browsers ignore control characters and whitespace inside a scheme, so `java\tscript:` must not slip through.
  // eslint-disable-next-line no-control-regex
  const compact = href.replace(/[\u0000- \u007f]/g, '')
  const scheme = URL_SCHEME.exec(compact)?.[1]
  if (scheme === undefined) return compact.startsWith('//') ? null : href
  return SAFE_URL_SCHEMES.has(`${scheme.toLowerCase()}:`) ? href : null
}

// Raw HTML is shown as text rather than filtered, so the output never needs an HTML sanitiser (which SSR would have to ship a DOM for).
const markdown = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)
      const url = issuesSafeUrl(href)
      if (url === null) return label
      const external = /^https?:/i.test(url)
      const attributes = [
        `href="${escapeHtml(url)}"`,
        title ? `title="${escapeHtml(title)}"` : '',
        external ? 'target="_blank" rel="noopener noreferrer"' : '',
      ].filter(Boolean).join(' ')
      return `<a ${attributes}>${label}</a>`
    },
    image({ href, title, text }) {
      const url = issuesSafeUrl(href)
      if (url === null) return escapeHtml(text)
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`
    },
  },
})

export function issuesRenderMarkdown(source: string): string {
  return markdown.parse(source, { async: false })
}
