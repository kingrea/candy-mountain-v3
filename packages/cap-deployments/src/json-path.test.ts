import { describe, expect, it } from 'vitest'
import { parseJsonPath, readJsonPath } from './json-path'

const segments = (path: string) => {
  const parsed = parseJsonPath(path)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.segments
}

describe('json paths', () => {
  it('parses dotted, bracket and quoted segments', () => {
    expect(segments('commit')).toEqual(['commit'])
    expect(segments('build.git.sha')).toEqual(['build', 'git', 'sha'])
    expect(segments('deploys[0].sha')).toEqual(['deploys', 0, 'sha'])
    expect(segments('$.meta["git.branch"]')).toEqual(['meta', 'git.branch'])
    expect(segments('$[\'a\\\'b\'][2]')).toEqual(['a\'b', 2])
    expect(segments('[0]')).toEqual([0])
    expect(segments('meta.git-branch')).toEqual(['meta', 'git-branch'])
  })

  it('rejects malformed paths', () => {
    for (const bad of ['', '$', 'a..b', 'a.', '.a', 'a[', 'a[x]', 'a["b"', 'a]b', 'a b']) {
      expect(parseJsonPath(bad).ok, bad).toBe(false)
    }
  })

  it('reads values and reports missing ones as undefined', () => {
    const body = { build: { sha: 'abc', tags: ['v1', 'v2'] }, list: [{ name: 'x' }] }
    expect(readJsonPath(body, segments('build.sha'))).toBe('abc')
    expect(readJsonPath(body, segments('build.tags[1]'))).toBe('v2')
    expect(readJsonPath(body, segments('list.0.name'))).toBe('x')
    expect(readJsonPath(body, segments('build.missing'))).toBeUndefined()
    expect(readJsonPath(body, segments('build.tags[5]'))).toBeUndefined()
    expect(readJsonPath(body, segments('build.sha.length'))).toBeUndefined()
    expect(readJsonPath(body, segments('constructor'))).toBeUndefined()
    expect(readJsonPath(body, segments('__proto__'))).toBeUndefined()
  })
})
