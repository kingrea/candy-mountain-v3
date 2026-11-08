import { afterAll, describe, expect, it } from 'vitest'
import { INFO_PATH } from '@candy-mountain/platform-sdk'
import { createTestApp, openTestDatabase, TEST_PRODUCT_CONFIG, testProduct } from '../testing'
import { dataPaths } from '../data-dir'
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
      productName: TEST_PRODUCT_CONFIG.name,
      scopeLabel: TEST_PRODUCT_CONFIG.scope.label,
    })
  })

  it('reads the name and scope label from the product it is given', async () => {
    const label = { singular: 'home', plural: 'homes', singularTitle: 'Home', pluralTitle: 'Homes' }
    const product = testProduct({}, { name: 'Home Dashboard', scope: { label, urlPrefix: 'h', listPath: 'homes' } })
    const res = await createTestApp({ db: database.db, paths: dataPaths('/tmp/cm-info'), product }).request(INFO_PATH)
    expect(await res.json()).toMatchObject({ productName: 'Home Dashboard', scopeLabel: label })
  })
})
