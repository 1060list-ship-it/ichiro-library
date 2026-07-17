import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'

const testEnv = getTestEnv()

test.describe('guest配列のentityリンクは完全一致でのみ発生する', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('完全一致のゲスト名はリンクされ、複合語・無関係語には部分一致でリンクされない', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    const slug = `linkify-guest-exact-${suffix}`
    const aliasWord = `テストバンド${suffix}`
    const videoId = `linkifyguestexact${suffix}`
    let entityId: string | undefined
    let streamId: string | undefined

    try {
      const { data: entity, error: entityError } = await service
        .from('entities')
        .insert({
          slug,
          name: aliasWord,
          match_names: [aliasWord],
          category: 'celebrity',
          description: 'テスト',
        })
        .select('id')
        .single()
      expect(entityError).toBeNull()
      entityId = entity?.id
      expect(entityId).toBeTruthy()

      const { data: stream, error: streamError } = await service
        .from('streams')
        .insert({
          video_id: videoId,
          title: 'linkify guest exact-match fixture',
          stream_date: '2026-01-01',
          guests: [aliasWord, `${aliasWord}ノート`, '無関係ゲスト'],
          status: 'public',
        })
        .select('id')
        .single()
      expect(streamError).toBeNull()
      streamId = stream?.id
      expect(streamId).toBeTruthy()

      const { error: linkError } = await service
        .from('stream_entities')
        .insert({ stream_id: streamId!, entity_id: entityId! })
      expect(linkError).toBeNull()

      await page.goto(`/stream/${videoId}`)

      // 完全一致するゲスト名にはリンクが付く
      const exactSpan = page.locator('span', { hasText: new RegExp(`^${aliasWord}$`) })
      await expect(exactSpan).toHaveCount(1)
      await expect(exactSpan.locator('a[href="/entity/' + slug + '"]')).toHaveCount(1)

      // 複合語（末尾に文字が続く）には部分一致でリンクが付かない
      const compoundSpan = page.locator('span', { hasText: new RegExp(`^${aliasWord}ノート$`) })
      await expect(compoundSpan).toHaveCount(1)
      await expect(compoundSpan.locator('a')).toHaveCount(0)

      // 無関係なゲスト名にはリンクが付かない
      const unrelatedSpan = page.locator('span', { hasText: /^無関係ゲスト$/ })
      await expect(unrelatedSpan).toHaveCount(1)
      await expect(unrelatedSpan.locator('a')).toHaveCount(0)
    } finally {
      if (streamId) {
        const { error } = await service.from('streams').delete().eq('id', streamId)
        expect(error).toBeNull()
      }
      if (entityId) {
        const { error } = await service.from('entities').delete().eq('id', entityId)
        expect(error).toBeNull()
      }
    }
  })

  test('＊マーカー付きゲスト名はマーカーを外して表示され、リンクは維持される', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    const slug = `linkify-guest-marker-${suffix}`
    const markerWord = `＊マーカーゲスト${suffix}`
    const videoId = `linkifyguestmarker${suffix}`
    let entityId: string | undefined
    let streamId: string | undefined

    try {
      const { data: entity, error: entityError } = await service
        .from('entities')
        .insert({
          slug,
          name: markerWord.slice(1),
          match_names: [markerWord],
          category: 'celebrity',
          description: 'テスト',
        })
        .select('id')
        .single()
      expect(entityError).toBeNull()
      entityId = entity?.id
      expect(entityId).toBeTruthy()

      const { data: stream, error: streamError } = await service
        .from('streams')
        .insert({
          video_id: videoId,
          title: 'linkify guest marker fixture',
          stream_date: '2026-01-01',
          guests: [markerWord],
          status: 'public',
        })
        .select('id')
        .single()
      expect(streamError).toBeNull()
      streamId = stream?.id
      expect(streamId).toBeTruthy()

      const { error: linkError } = await service
        .from('stream_entities')
        .insert({ stream_id: streamId!, entity_id: entityId! })
      expect(linkError).toBeNull()

      await page.goto(`/stream/${videoId}`)
      const link = page.locator(`a[href="/entity/${slug}"]`)
      await expect(link).toHaveText(`「${markerWord.slice(1)}」`)
    } finally {
      if (streamId) {
        const { error } = await service.from('streams').delete().eq('id', streamId)
        expect(error).toBeNull()
      }
      if (entityId) {
        const { error } = await service.from('entities').delete().eq('id', entityId)
        expect(error).toBeNull()
      }
    }
  })
})
