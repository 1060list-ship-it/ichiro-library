import { test, expect, getRoleSkipReason, submitLoginForm } from './fixtures'

test.describe('auth routes', () => {
  test('未ログインで /member にアクセスすると /login にリダイレクトされる', async ({ page }) => {
    await page.goto('/member')

    expect(new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('return')).toBe('/member')
  })

  test('未ログインで /admin にアクセスすると /login にリダイレクトされる', async ({ page }) => {
    await page.goto('/admin')

    expect(new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('return')).toBe('/admin')
  })

  test('login return=/member でログイン後に /member へリダイレクトされる', async ({ page, editorUser }) => {
    test.skip(!editorUser, getRoleSkipReason('editor'))

    await submitLoginForm(page, {
      email: editorUser!.email,
      password: editorUser!.password,
      returnTo: '/member',
    })

    await page.waitForURL((url) => url.pathname === '/member')
    expect(new URL(page.url()).pathname).toBe('/member')
  })

  for (const invalidReturnTo of [
    'https://evil.com',
    '//evil.com',
    '/%0d%0aSet-Cookie:%20session=evil',
  ]) {
    test(`login return=${invalidReturnTo} は / にフォールバックする`, async ({ page, editorUser }) => {
      test.skip(!editorUser, getRoleSkipReason('editor'))

      await submitLoginForm(page, {
        email: editorUser!.email,
        password: editorUser!.password,
        returnQueryValue: invalidReturnTo,
      })

      await page.waitForURL((url) => url.pathname === '/')
      expect(new URL(page.url()).pathname).toBe('/')
    })
  }
})
