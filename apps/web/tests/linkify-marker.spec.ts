import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'

const testEnv = getTestEnv()

test.describe('linkifyEntities marker display', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('＊marker in summary renders as 「」without the asterisk, still linked', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    const slug = `linkify-marker-test-${suffix}`
    const videoId = `linkifymarker${suffix}`
    let entityId: string | undefined
    let streamId: string | undefined

    try {
      const { data: entity, error: entityError } = await service
        .from('entities')
        .insert({
          slug,
          name: 'マーカー表示テスト曲',
          match_names: ['＊マーカー表示テスト曲'],
          category: 'song',
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
          title: 'linkify marker fixture',
          stream_date: '2026-01-01',
          summary: '今日は＊マーカー表示テスト曲を歌った。',
          status: 'public',
        })
        .select('id')
        .single()
      expect(streamError).toBeNull()
      streamId = stream?.id
      expect(streamId).toBeTruthy()

      await page.goto(`/stream/${videoId}`)
      const link = page.locator(`a[href="/entity/${slug}"]`)
      await expect(link).toHaveText('「マーカー表示テスト曲」')
      await expect(link).toHaveAttribute('href', `/entity/${slug}`)
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
