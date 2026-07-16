import { expect, test } from '@playwright/test'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

test.describe('searchSongs integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('exact normalized match is returned in exact bucket', async () => {
    const response = await invokeServerAction({
      actionName: 'searchSongs',
      actionArgs: ['夜の踊り子'],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toMatch(/"exact":\[[^\]]*"title":"夜の踊り子"/)
    expect(response.text).not.toMatch(/"partial":\[[^\]]*"title":"夜の踊り子"/)
  })

  test('partial normalized match is returned only in partial bucket', async () => {
    const response = await invokeServerAction({
      actionName: 'searchSongs',
      actionArgs: ['踊り子'],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toMatch(/"partial":\[[^\]]*"title":"夜の踊り子"/)
    expect(response.text).not.toMatch(/"exact":\[[^\]]*"title":"夜の踊り子"/)
  })

  test('empty query returns empty result without error', async () => {
    const response = await invokeServerAction({
      actionName: 'searchSongs',
      actionArgs: [''],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
  })
})
