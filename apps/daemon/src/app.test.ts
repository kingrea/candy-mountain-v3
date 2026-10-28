import { afterAll, describe, expect, it } from 'vitest'
import { HEALTH_PATH } from '@candy-mountain/shared'
import { createApp } from './app'
import { dataPaths } from './data-dir'
import { openTestDatabase } from './testing'

describe('daemon app', () => {
  const database = openTestDatabase()
  afterAll(() => database.close())

  it('answers the health check', async () => {
    const res = await createApp({ db: database.db, paths: dataPaths('/unused') }).request(HEALTH_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
