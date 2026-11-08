import { vi } from 'vitest'
import { fakeHosts, type FakeHandler } from './fake-hosts'

/** Stubs global fetch with the fake hosts; tests restore it with vi.unstubAllGlobals(). */
export function stubHosts(override?: FakeHandler) {
  const { requests, fetch } = fakeHosts(override)
  const fetchMock = vi.fn(fetch)
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}
