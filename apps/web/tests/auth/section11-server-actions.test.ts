import { test } from '@playwright/test'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()

function skipUnimplementedServerAction(name: string) {
  test.skip(true, `${name} Server Action はまだ UI/Action 接続が実装されていないためスキップします。`)
}

test.describe('Section 11 server actions', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('playlist 作成: 未ログイン 401 / editor 200 / admin 200', async () => {
    skipUnimplementedServerAction('playlist 作成')
  })

  test('playlist 削除: 未ログイン 401 / editor 200 / admin 200', async () => {
    skipUnimplementedServerAction('playlist 削除')
  })

  test('bookmark toggle: 未ログイン 401 / editor 200 / admin 200', async () => {
    skipUnimplementedServerAction('bookmark toggle')
  })

  test('entity word request 申請: 未ログイン 401 / editor 200 / admin 200', async () => {
    skipUnimplementedServerAction('entity word request 申請')
  })

  test('entity word request 承認: 未ログイン 401 / editor 403 / admin 200', async () => {
    skipUnimplementedServerAction('entity word request 承認')
  })
})
