import { expect, test } from '@playwright/test'
import { createAuthCookieHeader, getAppBaseUrl } from '../helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()

async function getResponse(pathname: string, cookieHeader?: string) {
  return fetch(new URL(pathname, getAppBaseUrl()), {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    redirect: 'manual',
  })
}

function expectLoginRedirect(location: string | null, expectedReturnTo: string) {
  expect(location).not.toBeNull()

  const redirectUrl = new URL(location!, getAppBaseUrl())
  expect(redirectUrl.pathname).toBe('/login')
  expect(redirectUrl.searchParams.get('return')).toBe(expectedReturnTo)
}

test.describe('Section 11 route protection', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('未ログインで GET /member は /login にリダイレクトされる', async () => {
    const response = await getResponse('/member')

    expect(response.status).toBe(307)
    expectLoginRedirect(response.headers.get('location'), '/member')
  })

  test('未ログインで GET /admin は /login にリダイレクトされる', async () => {
    const response = await getResponse('/admin')

    expect(response.status).toBe(307)
    expectLoginRedirect(response.headers.get('location'), '/admin')
  })

  test('editor ログイン後に GET /member は 200 を返す', async () => {
    const response = await getResponse('/member', await createAuthCookieHeader('editor'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('editor')
    expect(html).toContain(testEnv!.editorEmail)
  })

  test('admin ログイン後に GET /admin は 200 を返す', async () => {
    const response = await getResponse('/admin', await createAuthCookieHeader('admin'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('ichiro library 管理画面')
  })

  test.describe('open redirect prevention', () => {
    const redirectCases = [
      { name: 'return=https://evil.com は / にフォールバックする', query: 'return=https://evil.com', expectedPath: '/' },
      { name: 'return=//evil.com は / にフォールバックする', query: 'return=//evil.com', expectedPath: '/' },
      { name: 'return=/member は /member に遷移する', query: 'return=/member', expectedPath: '/member' },
      { name: 'return=/%0d%0aSet-Cookie:%20session=evil は / にフォールバックする', query: 'return=/%0d%0aSet-Cookie:%20session=evil', expectedPath: '/' },
    ] as const

    for (const redirectCase of redirectCases) {
      test(redirectCase.name, async () => {
        const response = await getResponse(`/login?${redirectCase.query}`, await createAuthCookieHeader('editor'))

        expect(response.status).toBe(307)

        const redirectUrl = new URL(response.headers.get('location')!, getAppBaseUrl())
        expect(redirectUrl.pathname).toBe(redirectCase.expectedPath)
      })
    }
  })
})
