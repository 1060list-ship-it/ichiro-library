import { expect, test, type Page } from '@playwright/test'
import { loginAs } from '../helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()

async function submitLogin(
  page: Page,
  options: {
    email: string
    password: string
    returnQuery: string
  },
) {
  await page.goto(`/login?${options.returnQuery}`)
  await page.getByLabel('Email').fill(options.email)
  await page.getByLabel('Password').fill(options.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
}

test.describe('Section 11 route protection', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test.describe('GET /member', () => {
    test('未ログインでは /login?return=/member にリダイレクトする', async ({ page }) => {
      await page.goto('/member')

      expect(new URL(page.url()).pathname).toBe('/login')
      expect(new URL(page.url()).searchParams.get('return')).toBe('/member')
    })

    test('editor は /member を閲覧できる', async ({ page }) => {
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
  })

  test.describe('GET /admin', () => {
    test('未ログインでは /login?return=/admin にリダイレクトする', async ({ page }) => {
      await page.goto('/admin')

      expect(new URL(page.url()).pathname).toBe('/login')
      expect(new URL(page.url()).searchParams.get('return')).toBe('/admin')
    })

    test('editor は proxy 通過後に DAL で 403 になる', async ({ page }) => {
      test.fixme(
        true,
        '現行実装は requireRoleOrRedirect() が Forbidden を /login へリダイレクトするため、/admin の 403 化完了後に有効化する。',
      )

      await loginAs(page, 'editor')
      const response = await page.goto('/admin')

      expect(response?.status()).toBe(403)
    })

    test('admin は /admin を閲覧できる', async ({ page }) => {
      await loginAs(page, 'admin')
      const response = await page.goto('/admin')

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { name: 'ichiro library 管理画面' })).toBeVisible()
    })
  })

  test.describe('open redirect prevention', () => {
    const redirectCases = [
      { name: 'return=https://evil.com は / にフォールバックする', query: 'return=https://evil.com', expectedPath: '/' },
      { name: 'return=//evil.com は / にフォールバックする', query: 'return=//evil.com', expectedPath: '/' },
      { name: 'return=/member は /member に遷移する', query: 'return=/member', expectedPath: '/member' },
      { name: 'return=/%0d%0aSet-Cookie:%20session=evil は / にフォールバックする', query: 'return=/%0d%0aSet-Cookie:%20session=evil', expectedPath: '/' },
      { name: 'return=/\\\\evil.com は / にフォールバックする', query: `return=${encodeURIComponent('/\\evil.com')}`, expectedPath: '/' },
      { name: 'return=/%5C%5Cevil.com は / にフォールバックする', query: 'return=/%5C%5Cevil.com', expectedPath: '/' },
    ] as const

    for (const redirectCase of redirectCases) {
      test(redirectCase.name, async ({ page }) => {
        await submitLogin(page, {
          email: testEnv!.editorEmail,
          password: testEnv!.editorPassword,
          returnQuery: redirectCase.query,
        })

        await page.waitForURL((url) => url.pathname === redirectCase.expectedPath)
        expect(new URL(page.url()).pathname).toBe(redirectCase.expectedPath)
      })
    }
  })
})
