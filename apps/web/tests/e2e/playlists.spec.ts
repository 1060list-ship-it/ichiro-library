import { test, expect, getRoleSkipReason } from './fixtures'

function buildPlaylistName(prefix: string) {
  return `${prefix} ${Date.now()}`
}

async function createPlaylist(page: import('@playwright/test').Page, title: string, description: string) {
  await page.locator('#create-playlist-title').fill(title)
  await page.locator('#create-playlist-description').fill(description)
  await page.getByRole('button', { name: '+ 新しいプレイリストを作成' }).click()
}

async function deletePlaylistByTitle(page: import('@playwright/test').Page, title: string) {
  const card = page.locator('article').filter({
    has: page.getByRole('heading', { name: title }),
  }).first()

  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '削除' }).click()
  await expect(card).toHaveCount(0)
}

test.describe('member playlists', () => {
  test('editor ログイン後に /member でプレイリスト作成フォームが表示される', async ({ page, editorUser, loginAs }) => {
    test.skip(!editorUser, getRoleSkipReason('editor'))

    await loginAs('editor', '/member')
    await page.waitForURL((url) => url.pathname === '/member')

    await expect(page.getByRole('heading', { name: 'Member Console' })).toBeVisible()
    await expect(page.locator('#create-playlist-title')).toBeVisible()
    await expect(page.locator('#create-playlist-description')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ 新しいプレイリストを作成' })).toBeVisible()
  })

  test('プレイリストを作成すると一覧に追加される', async ({ page, editorUser, loginAs }) => {
    test.skip(!editorUser, getRoleSkipReason('editor'))

    const title = buildPlaylistName('E2E create playlist')
    const description = 'Playwright E2E create verification'

    await loginAs('editor', '/member')
    await page.waitForURL((url) => url.pathname === '/member')

    await createPlaylist(page, title, description)

    const card = page.locator('article').filter({
      has: page.getByRole('heading', { name: title }),
    }).first()

    await expect(card).toBeVisible()
    await expect(card.getByText(title, { exact: true })).toBeVisible()

    await deletePlaylistByTitle(page, title)
  })

  test('プレイリストを削除すると一覧から消える', async ({ page, editorUser, loginAs }) => {
    test.skip(!editorUser, getRoleSkipReason('editor'))

    const title = buildPlaylistName('E2E delete playlist')
    const description = 'Playwright E2E delete verification'

    await loginAs('editor', '/member')
    await page.waitForURL((url) => url.pathname === '/member')

    await createPlaylist(page, title, description)
    await deletePlaylistByTitle(page, title)
  })
})
