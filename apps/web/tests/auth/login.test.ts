import { expect, test, type Page } from '@playwright/test'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()

async function submitLogin(
  page: Page,
  options: {
    email: string
    password: string
    returnQuery?: string
  },
) {
  const query = options.returnQuery ?? 'return=/member'

  await page.goto(`/login?${query}`)
  await page.getByLabel('Email').fill(options.email)
  await page.getByLabel('Password').fill(options.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
}

test.describe('login', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('正常ログインで returnTo へリダイレクトする', async ({ page }) => {
    await submitLogin(page, {
      email: testEnv!.editorEmail,
      password: testEnv!.editorPassword,
      returnQuery: 'return=/member',
    })

    await page.waitForURL((url) => url.pathname === '/member')
    expect(new URL(page.url()).pathname).toBe('/member')
  })

  test('不正パスワードではエラーメッセージを表示する', async ({ page }) => {
    await submitLogin(page, {
      email: testEnv!.editorEmail,
      password: 'invalid-password',
    })

    await expect(page.getByText('メールアドレスまたはパスワードが正しくありません。')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/login')
  })

  const redirectCases = [
    { name: 'return=https://evil.com は / にフォールバックする', query: 'return=https://evil.com' },
    { name: 'return=//evil.com は / にフォールバックする', query: 'return=//evil.com' },
    { name: 'return=/\\evil.com は / にフォールバックする', query: `return=${encodeURIComponent('/\\evil.com')}` },
    { name: 'return=/%5C%5Cevil.com は / にフォールバックする', query: 'return=/%5C%5Cevil.com' },
    { name: 'return=/%0d%0aSet-Cookie:session=evil は / にフォールバックする', query: 'return=/%0d%0aSet-Cookie:session=evil' },
  ] as const

  for (const redirectCase of redirectCases) {
    test(redirectCase.name, async ({ page }) => {
      await submitLogin(page, {
        email: testEnv!.editorEmail,
        password: testEnv!.editorPassword,
        returnQuery: redirectCase.query,
      })

      await page.waitForURL('**/')
      expect(new URL(page.url()).pathname).toBe('/')
    })
  }

  test('return=/member ではログイン後に /member へ遷移する', async ({ page }) => {
    await submitLogin(page, {
      email: testEnv!.editorEmail,
      password: testEnv!.editorPassword,
      returnQuery: 'return=/member',
    })

    await page.waitForURL((url) => url.pathname === '/member')
    expect(new URL(page.url()).pathname).toBe('/member')
  })
})
