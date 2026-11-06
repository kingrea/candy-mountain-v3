import { describe, expect, it } from 'vitest'
import { workspaceViewRoute } from './registry'
import { chatThreadLink } from './threads'

describe('scoped link builders', () => {
  it('put the given prefix in front of the slug', () => {
    expect(workspaceViewRoute('w', 'acme', '')).toBe('/w/acme')
    expect(workspaceViewRoute('w', 'acme', 'issues/board')).toBe('/w/acme/issues/board')
    expect(chatThreadLink('w', 'acme', 't 1')).toBe('/w/acme?thread=t%201')
  })
})
