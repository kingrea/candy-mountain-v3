import { describe, expect, it } from 'vitest'
import { isHealthResponse } from './health'

describe('isHealthResponse', () => {
  it('accepts a known status', () => {
    expect(isHealthResponse({ status: 'ok' })).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isHealthResponse({ status: 'down' })).toBe(false)
    expect(isHealthResponse(null)).toBe(false)
    expect(isHealthResponse('ok')).toBe(false)
  })
})
