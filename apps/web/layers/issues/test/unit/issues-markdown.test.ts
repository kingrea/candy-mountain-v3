import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { issuesRenderMarkdown, issuesSafeUrl } from '../../app/utils/issues-markdown'

const hostile = readFileSync(new URL('../fixtures/hostile-markdown.md', import.meta.url), 'utf8')

describe('issuesRenderMarkdown', () => {
  const html = issuesRenderMarkdown(hostile)

  it('renders ordinary markdown', () => {
    expect(html).toContain('<h2>Plan</h2>')
    expect(html).toContain('<strong>it</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<a href="https://example.com/docs" title="Docs" target="_blank" rel="noopener noreferrer">docs link</a>')
    expect(html).toContain('<a href="/p/cm/issues/x">relative</a>')
    expect(html).toContain('<input checked="" disabled="" type="checkbox">')
  })

  it('shows raw HTML as text instead of markup', () => {
    expect(html).not.toMatch(/<script|<img|<iframe|<b[\s>]/i)
    expect(html).toContain('&lt;script&gt;alert(&#39;owned&#39;)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;b onclick=&quot;alert(2)&quot;&gt;bold&lt;/b&gt;')
  })

  it('drops links and images with unsafe schemes but keeps their text', () => {
    expect(html).not.toMatch(/href="(javascript|java\s*script|data):/i)
    expect(html).not.toMatch(/src="javascript:/i)
    expect(html).toContain('click me')
    expect(html).toContain('pixel')
  })

  it('leaves no event handler attributes on any element', () => {
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+=/i)
  })
})

describe('issuesSafeUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com',
    'mailto:jack@example.com',
    '/p/cm/issues/abc',
    '#section',
    'relative/path',
  ])('keeps %s', (url) => {
    expect(issuesSafeUrl(url)).toBe(url)
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '//evil.example/x',
  ])('refuses %j', (url) => {
    expect(issuesSafeUrl(url)).toBeNull()
  })
})
