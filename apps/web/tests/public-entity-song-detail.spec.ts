import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'

const testEnv = getTestEnv()

test.describe('public entity detail page song meta', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('song entity detail page shows album info', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const slug = `public-song-detail-${Date.now()}`

    const { data: song, error: songError } = await service
      .from('songs')
      .insert({ title: '公開ページ確認曲', album: '確認用アルバム', disc_no: 1, track_no: 1 })
      .select('id')
      .single()
    expect(songError).toBeNull()

    const { data: entity, error: entityError } = await service
      .from('entities')
      .insert({
        slug,
        name: '公開ページ確認曲',
        match_names: ['＊公開ページ確認曲'],
        category: 'song',
        description: 'テスト説明',
        song_id: song!.id,
      })
      .select('id')
      .single()
    expect(entityError).toBeNull()

    try {
      await page.goto(`/entity/${slug}`)
      await expect(page.getByText('確認用アルバム')).toBeVisible()
    } finally {
      await service.from('entities').delete().eq('id', entity!.id)
      await service.from('songs').delete().eq('id', song!.id)
    }
  })

  test('non-song entity detail page does not show album section', async ({ page }) => {
    await page.goto('/entity')
    // 既存の非song entityの詳細ページに「確認用アルバム」のような楽曲メタ表記が出ないことを
    // スモークチェックする（既存entity一覧から1件開いて確認）
    const firstLink = page.locator('a[href^="/entity/"]').first()
    await firstLink.click()
    await expect(page.getByText(/Album|アルバム情報/)).toHaveCount(0)
  })
})
