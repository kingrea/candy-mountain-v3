import { afterAll, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN_PRODUCT, INFO_PATH } from '@candy-mountain/shared'
import { createTestApp } from '../testing/platform'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import { dataPaths } from '../data-dir'
import { openTestDatabase } from '../testing'
import pkg from '../../package.json'

describe('info route', () => {
  const database = openTestDatabase()
  afterAll(() => database.close())

  it('reports version, data directory, auth strategy, product name and scope label', async () => {
    const res = await createTestApp({ db: database.db, paths: dataPaths('/tmp/cm-info') }).request(INFO_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      version: pkg.version,
      dataDir: '/tmp/cm-info',
      authStrategy: 'development',
      productName: 'Candy Mountain',
      scopeLabel: { singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' },
    })
  })

  it('reads the name and scope label from the product it is given', async () => {
    const label = { singular: 'home', plural: 'homes', singularTitle: 'Home', pluralTitle: 'Homes' }
    const product = { ...CANDY_MOUNTAIN, config: { ...CANDY_MOUNTAIN_PRODUCT, name: 'Home Dashboard', scope: { label, urlPrefix: 'h' } } }
    const res = await createTestApp({ db: database.db, paths: dataPaths('/tmp/cm-info'), product }).request(INFO_PATH)
    expect(await res.json()).toMatchObject({ productName: 'Home Dashboard', scopeLabel: label })
  })
})
