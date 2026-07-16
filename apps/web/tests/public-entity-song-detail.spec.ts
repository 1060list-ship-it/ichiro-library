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

  test('song entity detail page does not show album section when song meta is empty', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const slug = `public-song-empty-meta-${Date.now()}`
    let songId: string | undefined
    let entityId: string | undefined

    try {
      const { data: song, error: songError } = await service
        .from('songs')
        .insert({ title: '公開ページ空メタ確認曲' })
        .select('id')
        .single()
      expect(songError).toBeNull()
      songId = song?.id
      expect(songId).toBeTruthy()

      const { data: entity, error: entityError } = await service
        .from('entities')
        .insert({
          slug,
          name: '公開ページ空メタ確認曲',
          match_names: ['＊公開ページ空メタ確認曲'],
          category: 'song',
          description: 'テスト説明',
          song_id: songId,
        })
        .select('id')
        .single()
      expect(entityError).toBeNull()
      entityId = entity?.id
      expect(entityId).toBeTruthy()

      await page.goto(`/entity/${slug}`)
      await expect(page.getByText('Album Info', { exact: true })).toHaveCount(0)
    } finally {
      if (entityId) {
        const { error } = await service.from('entities').delete().eq('id', entityId)
        expect(error).toBeNull()
      }
      if (songId) {
        const { error } = await service.from('songs').delete().eq('id', songId)
        expect(error).toBeNull()
      }
    }
  })

  test('non-song entity detail page does not show album section', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const slug = `public-non-song-detail-${Date.now()}`
    let entityId: string | undefined

    try {
      const { data: entity, error: entityError } = await service
        .from('entities')
        .insert({
          slug,
          name: '公開ページ確認人物',
          match_names: ['公開ページ確認人物'],
          category: 'celebrity',
          description: 'テスト説明',
        })
        .select('id')
        .single()
      expect(entityError).toBeNull()
      entityId = entity?.id
      expect(entityId).toBeTruthy()

      await page.goto(`/entity/${slug}`)
      await expect(page.getByText('Album Info', { exact: true })).toHaveCount(0)
    } finally {
      if (entityId) {
        const { error } = await service.from('entities').delete().eq('id', entityId)
        expect(error).toBeNull()
      }
    }
  })
})
