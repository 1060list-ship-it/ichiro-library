import { expect, test } from '@playwright/test'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

test.describe('previewSongMatches integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('short aliases under 3 chars are excluded and return zero hits', async () => {
    const response = await invokeServerAction({
      actionName: 'previewSongMatches',
      actionArgs: [['短']],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toContain('"total":0')
  })

  test('nonexistent phrase returns zero hits without error', async () => {
    const response = await invokeServerAction({
      actionName: 'previewSongMatches',
      actionArgs: [['絶対にヒットしないはずの架空曲名xyz123']],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toContain('"total":0')
  })
})
