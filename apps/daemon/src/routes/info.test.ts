import { afterAll, describe, expect, it } from 'vitest'
import { INFO_PATH } from '@candy-mountain/shared'
import { createApp } from '../app'
import { dataPaths } from '../data-dir'
import { openTestDatabase } from '../testing'
import pkg from '../../package.json'

describe('info route', () => {
  const database = openTestDatabase()
  afterAll(() => database.close())

  it('reports version, data directory and auth strategy', async () => {
    const res = await createApp({ db: database.db, paths: dataPaths('/tmp/cm-info') }).request(INFO_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: pkg.version,
      dataDir: '/tmp/cm-info',
      authStrategy: 'development',
    })
  })
})
