import { expect, test } from '@playwright/test'
import { loginAs, logout } from '../helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()

test.describe('member access', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('未ログインでは /login?return=/member にリダイレクトする', async ({ page }) => {
    await page.goto('/member')

    expect(new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('return')).toBe('/member')
  })

  test('editor は /member を閲覧でき、role と email が表示される', async ({ page }) => {
    await loginAs(page, 'editor')
    await page.goto('/member')

    expect(new URL(page.url()).pathname).toBe('/member')
    await expect(page.getByText('editor', { exact: true })).toBeVisible()
    await expect(page.getByText(testEnv!.editorEmail, { exact: true })).toBeVisible()
  })

  test('admin は /member を閲覧できる', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/member')

    expect(new URL(page.url()).pathname).toBe('/member')
    await expect(page.getByText('admin', { exact: true })).toBeVisible()
    await expect(page.getByText(testEnv!.adminEmail, { exact: true })).toBeVisible()
  })

  test('ログアウト後は / にリダイレクトされ、/member 再訪でログイン画面へ戻る', async ({ page }) => {
    await loginAs(page, 'editor')
    await logout(page)

    expect(new URL(page.url()).pathname).toBe('/')

    await page.goto('/member')
    expect(new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('return')).toBe('/member')
  })
})
