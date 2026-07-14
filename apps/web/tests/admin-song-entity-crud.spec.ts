import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

function uniqueSlug() {
  return `test-song-entity-${Date.now()}${Math.random().toString(36).slice(2, 6)}`
}

async function cleanupBySlug(slug: string) {
  const service = getSupabaseServiceRoleClient()
  const { data } = await service.from('entities').select('id, song_id').eq('slug', slug).maybeSingle()
  if (data) {
    await service.from('entities').delete().eq('id', data.id)
    if (data.song_id) {
      await service.from('songs').delete().eq('id', data.song_id)
    }
  }
}

test.describe('createSongEntity / updateSongMetaAction integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('creates a new song and entity via route A', async () => {
    const slug = uniqueSlug()
    try {
      const response = await invokeServerAction({
        actionName: 'createSongEntity',
        actionArgs: [{
          songId: null,
          songTitle: 'E2Eテスト楽曲',
          songAlbum: 'テストシングル',
          songDiscNo: '1',
          songTrackNo: '1',
          songReleasedAt: '2026-01-01',
          songNotes: '',
          entitySlug: slug,
          entityName: 'E2Eテスト楽曲',
          entityMatchNames: ['＊E2Eテスト楽曲'],
          entityDescription: 'テスト説明',
          entityRelatedWork: '',
          entityExternalUrl: '',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: '/admin/entity/new',
        role: 'admin',
      })

      expect(response.status).toBe(200)
      expect(response.errorMessage).toBeNull()

      const service = getSupabaseServiceRoleClient()
      const { data } = await service.from('entities').select('category, song_id').eq('slug', slug).single()
      expect(data?.category).toBe('song')
      expect(data?.song_id).not.toBeNull()
    } finally {
      await cleanupBySlug(slug)
    }
  })

  test('match_names shorter than 3 chars is rejected', async () => {
    const slug = uniqueSlug()
    try {
      const response = await invokeServerAction({
        actionName: 'createSongEntity',
        actionArgs: [{
          songId: null,
          songTitle: '短題テスト',
          songAlbum: '',
          songDiscNo: '',
          songTrackNo: '',
          songReleasedAt: '',
          songNotes: '',
          entitySlug: slug,
          entityName: '短題テスト',
          entityMatchNames: ['短'],
          entityDescription: '',
          entityRelatedWork: '',
          entityExternalUrl: '',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: '/admin/entity/new',
        role: 'admin',
      })

      expect(response.errorMessage).not.toBeNull()
    } finally {
      await cleanupBySlug(slug)
    }
  })

  test('updateSongMetaAction updates songs row', async () => {
    const slug = uniqueSlug()
    try {
      const createResponse = await invokeServerAction({
        actionName: 'createSongEntity',
        actionArgs: [{
          songId: null,
          songTitle: 'メタ更新テスト曲',
          songAlbum: '旧アルバム',
          songDiscNo: '1',
          songTrackNo: '1',
          songReleasedAt: '2026-01-01',
          songNotes: '',
          entitySlug: slug,
          entityName: 'メタ更新テスト曲',
          entityMatchNames: ['＊メタ更新テスト曲'],
          entityDescription: '',
          entityRelatedWork: '',
          entityExternalUrl: '',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: '/admin/entity/new',
        role: 'admin',
      })
      expect(createResponse.errorMessage).toBeNull()

      const service = getSupabaseServiceRoleClient()
      const { data: entity } = await service.from('entities').select('song_id').eq('slug', slug).single()
      const songId = entity?.song_id as string

      const updateResponse = await invokeServerAction({
        actionName: 'updateSongMetaAction',
        actionArgs: [{
          songId,
          title: 'メタ更新テスト曲',
          album: '新アルバム',
          discNo: '1',
          trackNo: '2',
          releasedAt: '2026-02-01',
          notes: '更新済み',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: '/admin/entity/new',
        role: 'admin',
      })

      expect(updateResponse.status).toBe(200)
      expect(updateResponse.errorMessage).toBeNull()

      const { data: song } = await service.from('songs').select('album, notes').eq('id', songId).single()
      expect(song?.album).toBe('新アルバム')
      expect(song?.notes).toBe('更新済み')
    } finally {
      await cleanupBySlug(slug)
    }
  })
})
