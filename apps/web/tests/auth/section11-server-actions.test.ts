import { expect, test } from '@playwright/test'
import {
  createAuthCookieHeader,
  getSupabaseRoleClient,
  getSupabaseServiceRoleClient,
} from '../helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'
import {
  invokeMemberServerActionAsUnauthorized,
  invokeServerAction,
  type ServerActionResponse,
} from '../helpers/server-actions'

const testEnv = getTestEnv()

type StreamFixture = {
  id: string
  video_id: string
}

async function requireRoleUserId(role: 'editor' | 'admin') {
  const supabase = await getSupabaseRoleClient(role)
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    throw new Error(`Failed to resolve ${role} fixture user: ${error?.message ?? 'user missing'}`)
  }

  return data.user.id
}

async function requireSeedStreams(limit: number) {
  const service = getSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('streams')
    .select('id, video_id')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load stream fixtures: ${error.message}`)
  }

  if (!data || data.length < limit) {
    throw new Error(`Section 11 server-action tests require at least ${limit} seeded streams.`)
  }

  return data as StreamFixture[]
}

async function createPlaylistFixture(createdBy: string, titlePrefix: string) {
  const service = getSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('playlists')
    .insert({
      title: `${titlePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select('id, updated_at')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create playlist fixture: ${error?.message ?? 'unknown error'}`)
  }

  return data
}

async function insertPlaylistStreamFixture(playlistId: string, streamId: string, addedBy: string, position: string) {
  const service = getSupabaseServiceRoleClient()
  const { error } = await service
    .from('playlist_streams')
    .insert({
      playlist_id: playlistId,
      stream_id: streamId,
      position,
      added_by: addedBy,
    })

  if (error) {
    throw new Error(`Failed to create playlist_stream fixture: ${error.message}`)
  }
}

async function deletePlaylistFixture(playlistId: string) {
  const service = getSupabaseServiceRoleClient()

  await service
    .from('playlist_streams')
    .delete()
    .eq('playlist_id', playlistId)

  await service
    .from('playlists')
    .delete()
    .eq('id', playlistId)
}

function expectUnauthorized(response: ServerActionResponse) {
  expect(response.status).toBe(500)
  expect(response.errorMessage).toBe('Unauthorized')
}

function expectActionSuccess(response: ServerActionResponse) {
  expect(response.status).toBe(200)
  expect(response.errorMessage).toBeNull()
}

test.describe('Section 11 server actions', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(
    !testEnv?.serviceRoleKey,
    'SUPABASE_SERVICE_ROLE_KEY が未設定のため、Section 11 Server Action fixture を作成できません。',
  )

  test('未ログイン相当では playlist 作成 Server Action が Unauthorized で拒否される', async () => {
    // no-cookie では proxy が先に /login へリダイレクトするため、
    // stale cookie で proxy を通して DAL 側の Unauthorized を確認する。
    const response = await invokeMemberServerActionAsUnauthorized('createPlaylist', [
      `section11-unauthorized-${Date.now()}`,
      'unauthorized fixture',
    ])

    expectUnauthorized(response)
  })

  test('editor は playlist 作成 Server Action を実行できる', async () => {
    const service = getSupabaseServiceRoleClient()
    const editorId = await requireRoleUserId('editor')
    const title = `section11-create-${Date.now()}`

    try {
      const response = await invokeServerAction({
        actionName: 'createPlaylist',
        actionArgs: [title, 'created by section11 e2e'],
        manifestRoute: 'member',
        pagePath: '/member',
        role: 'editor',
      })

      expectActionSuccess(response)

      const { data, error } = await service
        .from('playlists')
        .select('id, created_by')
        .eq('title', title)
        .eq('created_by', editorId)
        .maybeSingle()

      expect(error).toBeNull()
      expect(data?.created_by).toBe(editorId)

      if (data?.id) {
        await deletePlaylistFixture(data.id)
      }
    } finally {
      await service
        .from('playlists')
        .delete()
        .eq('title', title)
    }
  })

  test('editor は他者作成 playlist を削除できる', async () => {
    const service = getSupabaseServiceRoleClient()
    const adminId = await requireRoleUserId('admin')
    const playlist = await createPlaylistFixture(adminId, 'section11-delete')

    try {
      const response = await invokeServerAction({
        actionName: 'deletePlaylist',
        actionArgs: [playlist.id, playlist.updated_at],
        manifestRoute: 'member',
        pagePath: '/member',
        role: 'editor',
      })

      expectActionSuccess(response)

      const { data, error } = await service
        .from('playlists')
        .select('id')
        .eq('id', playlist.id)
        .maybeSingle()

      expect(error).toBeNull()
      expect(data).toBeNull()
    } finally {
      await deletePlaylistFixture(playlist.id)
    }
  })

  test('未ログインでは bookmark toggle Server Action が Unauthorized で拒否される', async () => {
    const editorId = await requireRoleUserId('editor')
    const [stream] = await requireSeedStreams(1)
    const playlist = await createPlaylistFixture(editorId, 'section11-bookmark-public')

    try {
      await insertPlaylistStreamFixture(playlist.id, stream.id, editorId, '10000.00000000')

      const response = await invokeServerAction({
        actionName: 'toggleBookmark',
        actionArgs: [stream.id],
        manifestRoute: 'playlist/[id]',
        pagePath: `/playlist/${playlist.id}`,
      })

      expectUnauthorized(response)
    } finally {
      await deletePlaylistFixture(playlist.id)
    }
  })

  test('editor は bookmark toggle Server Action を実行でき、本人行だけが作成される', async () => {
    const service = getSupabaseServiceRoleClient()
    const editorId = await requireRoleUserId('editor')
    const [stream] = await requireSeedStreams(1)
    const playlist = await createPlaylistFixture(editorId, 'section11-bookmark-editor')

    try {
      await insertPlaylistStreamFixture(playlist.id, stream.id, editorId, '10000.00000000')

      const response = await invokeServerAction({
        actionName: 'toggleBookmark',
        actionArgs: [stream.id],
        manifestRoute: 'playlist/[id]',
        pagePath: `/playlist/${playlist.id}`,
        role: 'editor',
      })

      expectActionSuccess(response)

      const { data, error } = await service
        .from('bookmarks')
        .select('user_id, stream_id')
        .eq('user_id', editorId)
        .eq('stream_id', stream.id)
        .maybeSingle()

      expect(error).toBeNull()
      expect(data).toEqual({
        user_id: editorId,
        stream_id: stream.id,
      })
    } finally {
      await service
        .from('bookmarks')
        .delete()
        .eq('user_id', editorId)
        .eq('stream_id', stream.id)

      await deletePlaylistFixture(playlist.id)
    }
  })

  test('playlist_streams 変更後に playlists.updated_at が更新される', async () => {
    const service = getSupabaseServiceRoleClient()
    const editorId = await requireRoleUserId('editor')
    const [stream] = await requireSeedStreams(1)
    const playlist = await createPlaylistFixture(editorId, 'section11-touch')

    try {
      const beforeUpdatedAt = playlist.updated_at

      const response = await invokeServerAction({
        actionName: 'addStreamToPlaylist',
        actionArgs: [playlist.id, stream.video_id, beforeUpdatedAt],
        manifestRoute: 'member',
        pagePath: '/member',
        role: 'editor',
      })

      expectActionSuccess(response)

      const { data, error } = await service
        .from('playlists')
        .select('updated_at')
        .eq('id', playlist.id)
        .single()

      expect(error).toBeNull()
      expect(data.updated_at).not.toBe(beforeUpdatedAt)
    } finally {
      await deletePlaylistFixture(playlist.id)
    }
  })

  test('同一 position への同時 reorder 後も最終 order は一意で、失敗時は再試行メッセージになる', async () => {
    const service = getSupabaseServiceRoleClient()
    const editorId = await requireRoleUserId('editor')
    const [firstStream, secondStream] = await requireSeedStreams(2)
    const playlist = await createPlaylistFixture(editorId, 'section11-concurrent-reorder')

    try {
      await insertPlaylistStreamFixture(playlist.id, firstStream.id, editorId, '10000.00000000')
      await insertPlaylistStreamFixture(playlist.id, secondStream.id, editorId, '20000.00000000')

      const actionCookieHeader = await createAuthCookieHeader('editor')
      const [firstResponse, secondResponse] = await Promise.all([
        invokeServerAction({
          actionName: 'reorderPlaylistStream',
          actionArgs: [playlist.id, firstStream.id, 15000, playlist.updated_at],
          manifestRoute: 'member',
          pagePath: '/member',
          actionCookieHeader,
          treeRole: 'editor',
        }),
        invokeServerAction({
          actionName: 'reorderPlaylistStream',
          actionArgs: [playlist.id, secondStream.id, 15000, playlist.updated_at],
          manifestRoute: 'member',
          pagePath: '/member',
          actionCookieHeader,
          treeRole: 'editor',
        }),
      ])

      const responses = [firstResponse, secondResponse]
      const retryResponse = responses.find((response) => response.errorMessage !== null)

      if (retryResponse) {
        expect(retryResponse.errorMessage).toBe('並び替えに失敗した。再試行してください')
      }

      const { data, error } = await service
        .from('playlist_streams')
        .select('stream_id, position')
        .eq('playlist_id', playlist.id)
        .order('position', { ascending: true })

      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      expect(new Set((data ?? []).map((row) => row.position)).size).toBe(2)
    } finally {
      await deletePlaylistFixture(playlist.id)
    }
  })
})
