import { describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN_PRODUCT } from './product'
import { projectViewRoute } from './registry'
import { chatThreadLink } from './threads'
import { uptimeMonitorLink } from './uptime'

describe('scoped link builders', () => {
  it('put the given prefix in front of the slug', () => {
    expect(projectViewRoute('w', 'acme', '')).toBe('/w/acme')
    expect(projectViewRoute('w', 'acme', 'issues/board')).toBe('/w/acme/issues/board')
    expect(chatThreadLink('w', 'acme', 't 1')).toBe('/w/acme?thread=t%201')
    expect(uptimeMonitorLink('w', 'acme', 'm/1')).toBe('/w/acme/uptime?monitor=m%2F1')
  })

  it('keep the Candy Mountain links under /p/', () => {
    const prefix = CANDY_MOUNTAIN_PRODUCT.scope.urlPrefix
    expect(projectViewRoute(prefix, 'acme', '')).toBe('/p/acme')
    expect(chatThreadLink(prefix, 'acme', 't1')).toBe('/p/acme?thread=t1')
    expect(uptimeMonitorLink(prefix, 'acme', 'm1')).toBe('/p/acme/uptime?monitor=m1')
  })
})
