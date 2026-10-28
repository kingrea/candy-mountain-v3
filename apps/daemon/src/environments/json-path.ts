export type JsonPathSegment = string | number

export type JsonPathParse = { ok: true, segments: JsonPathSegment[] } | { ok: false, error: string }

const DOTTED_KEY = /^[^.[\]'"\s]+/

/** Accepts `a.b[0].c`, `a["key.with.dots"]` and `$.a.b`; a dotted all-digit key also indexes arrays when read. */
export function parseJsonPath(path: string): JsonPathParse {
  let rest = path.trim()
  if (rest.startsWith('$')) {
    rest = rest.slice(1)
    if (rest.startsWith('.')) rest = rest.slice(1)
  }
  const segments: JsonPathSegment[] = []
  let first = true
  while (rest !== '') {
    if (rest.startsWith('[')) {
      const bracket = parseBracket(rest)
      if (!bracket) return { ok: false, error: `Path "${path}" has an unclosed or malformed [ ].` }
      segments.push(bracket.segment)
      rest = rest.slice(bracket.length)
    }
    else {
      if (!first) {
        if (!rest.startsWith('.')) return { ok: false, error: `Path "${path}" is missing a "." before "${rest}".` }
        rest = rest.slice(1)
      }
      const key = DOTTED_KEY.exec(rest)?.[0]
      if (!key) return { ok: false, error: `Path "${path}" has an empty or invalid key.` }
      segments.push(key)
      rest = rest.slice(key.length)
    }
    first = false
  }
  if (segments.length === 0) return { ok: false, error: 'Path must not be empty.' }
  return { ok: true, segments }
}

function parseBracket(text: string): { segment: JsonPathSegment, length: number } | null {
  const index = /^\[\s*(\d+)\s*\]/.exec(text)
  if (index) return { segment: Number(index[1]), length: index[0].length }
  const quote = text[1]
  if (quote !== '"' && quote !== '\'') return null
  let key = ''
  for (let i = 2; i < text.length; i++) {
    const char = text[i]!
    if (char === '\\' && i + 1 < text.length) {
      key += text[++i]
      continue
    }
    if (char === quote) {
      if (text[i + 1] !== ']') return null
      return { segment: key, length: i + 2 }
    }
    key += char
  }
  return null
}

/** Own properties only, so a path can never reach `__proto__` or `constructor`. */
export function readJsonPath(value: unknown, segments: readonly JsonPathSegment[]): unknown {
  let current = value
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = typeof segment === 'number' ? segment : /^\d+$/.test(segment) ? Number(segment) : Number.NaN
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined
      current = current[index]
    }
    else if (current !== null && typeof current === 'object') {
      const key = String(segment)
      if (!Object.hasOwn(current, key)) return undefined
      current = (current as Record<string, unknown>)[key]
    }
    else {
      return undefined
    }
  }
  return current
}
