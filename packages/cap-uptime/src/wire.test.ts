import { describe, expect, it } from 'vitest'
import { uptimeMonitorLink } from './wire'

describe('uptime links', () => {
  it('put the given prefix in front of the slug and encode the monitor id', () => {
    expect(uptimeMonitorLink('w', 'acme', 'm/1')).toBe('/w/acme/uptime?monitor=m%2F1')
    expect(uptimeMonitorLink('p', 'acme', 'm1')).toBe('/p/acme/uptime?monitor=m1')
  })
})
