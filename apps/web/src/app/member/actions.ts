'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Database, EntityWordRequest, Playlist, PlaylistStream, Stream } from '@/lib/types'

const PLAYLIST_SELECT = [
  'id',
  'title',
  'description',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
].join(', ')

const PLAYLIST_STREAM_SELECT = [
  'id',
  'playlist_id',
  'stream_id',
  'position',
  'added_by',
  'added_at',
].join(', ')

const ENTITY_WORD_REQUEST_SELECT = [
  'id',
  'entity_id',
  'word',
  'status',
  'requested_by',
  'reviewed_by',
  'requested_at',
  'reviewed_at',
].join(', ')

const BOOKMARKED_STREAM_SELECT = [
  'id',
  'video_id',
  'title',
  'stream_date',
  'duration_min',
  'view_count',
  'summary',
  'tags',
  'corner_names',
  'guests',
  'youtube_url',
  'thumbnail_url',
].join(', ')

type PlaylistInsert = Database['public']['Tables']['playlists']['Insert']
type PlaylistUpdate = Database['public']['Tables']['playlists']['Update']
type PlaylistStreamInsert = Database['public']['Tables']['playlist_streams']['Insert']
type BookmarkInsert = Database['public']['Tables']['bookmarks']['Insert']
type EntityWordRequestInsert = Database['public']['Tables']['entity_word_requests']['Insert']

type PlaylistTimestampRow = Pick<Playlist, 'id' | 'updated_at'>
type PlaylistTouchRow = Pick<Playlist, 'updated_at'>
type StreamIdRow = Pick<Stream, 'id'>
type StreamPositionRow = Pick<PlaylistStream, 'position'>
type EntityMatchNamesRow = Database['public']['Tables']['entities']['Row'] extends infer Row
  ? Row extends { id: string; match_names: string[] }
    ? Pick<Row, 'id' | 'match_names'>
    : never
  : never

type PostgrestErrorLike = {
  code?: string
  message?: string
}

type MemberBookmarkedStream = Pick<
  Stream,
  | 'id'
  | 'video_id'
  | 'title'
  | 'stream_date'
  | 'duration_min'
  | 'view_count'
  | 'summary'
  | 'tags'
  | 'corner_names'
  | 'guests'
  | 'youtube_url'
  | 'thumbnail_url'
>

type BookmarkedStreamRow = MemberBookmarkedStream & {
  bookmarks: { user_id: string }[] | { user_id: string } | null
}

function normalizeRequiredText(value: string, message: string) {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(message)
  }

  return normalized
}

function normalizeOptionalText(value?: string) {
  const normalized = value?.trim() ?? ''
  return normalized ? normalized : null
}

function normalizeStringArray(values?: string[]) {
  if (!values) {
    return []
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as PostgrestErrorLike).code === '23505',
  )
}

async function fetchPlaylistTimestamp(playlistId: string) {
  const { data, error } = await supabaseAdmin
    .from('playlists')
    .select('id, updated_at')
    .eq('id', playlistId)
    .maybeSingle()

  if (error) {
    throw new Error(`playlists lookup failed: ${error.message}`)
  }

  return data as PlaylistTimestampRow | null
}

async function assertPlaylistLock(playlistId: string, updatedAt?: string) {
  const playlist = await fetchPlaylistTimestamp(playlistId)

  if (!playlist) {
    throw new Error('プレイリストが見つからない')
  }

  if (updatedAt && playlist.updated_at !== updatedAt) {
    throw new Error('409 Conflict')
  }

  return playlist
}

async function touchPlaylist(playlistId: string, userId: string) {
  const payload: PlaylistUpdate = {
    updated_by: userId,
  }

  const { data, error } = await supabaseAdmin
    .from('playlists')
    .update(payload as never)
    .select('updated_at')
    .eq('id', playlistId)
    .maybeSingle()

  if (error) {
    throw new Error(`playlists touch failed: ${error.message}`)
  }

  const row = data as PlaylistTouchRow | null

  if (!row) {
    throw new Error('プレイリストが見つからない')
  }

  return row.updated_at
}

function revalidatePlaylistPaths(playlistId?: string) {
  revalidatePath('/')
  revalidatePath('/member')
  revalidatePath('/playlists')

  if (playlistId) {
    revalidatePath(`/playlist/${playlistId}`)
  }
}

function revalidateEntityRequestPaths(entityId?: string) {
  revalidatePath('/member')
  revalidatePath('/admin')
  revalidatePath('/admin/entity')
  revalidatePath('/entity')

  if (entityId) {
    revalidatePath(`/admin/entity/${entityId}`)
  }
}

function buildBookmarkedStreamsQuery(userId: string, filters?: { tags?: string[]; corners?: string[] }) {
  const tags = normalizeStringArray(filters?.tags)
  const corners = normalizeStringArray(filters?.corners)

  let query = supabaseAdmin
    .from('streams')
    .select(`${BOOKMARKED_STREAM_SELECT}, bookmarks!inner(user_id)`)
    .eq('bookmarks.user_id', userId)
    .order('stream_date', { ascending: false })

  if (tags.length > 0) {
    query = query.contains('tags', tags)
  }

  if (corners.length > 0) {
    query = query.contains('corner_names', corners)
  }

  return query
}

function stripBookmarkRelation(row: BookmarkedStreamRow): MemberBookmarkedStream {
  return {
    id: row.id,
    video_id: row.video_id,
    title: row.title,
    stream_date: row.stream_date,
    duration_min: row.duration_min,
    view_count: row.view_count,
    summary: row.summary,
    tags: row.tags,
    corner_names: row.corner_names,
    guests: row.guests,
    youtube_url: row.youtube_url,
    thumbnail_url: row.thumbnail_url,
  }
}

export async function createPlaylist(title: string, description?: string) {
  const { user } = await requireRole(['editor', 'admin'])

  const payload: PlaylistInsert = {
    title: normalizeRequiredText(title, 'タイトルを入力してください'),
    description: normalizeOptionalText(description),
    created_by: user.id,
    updated_by: user.id,
  }

  const { data, error } = await supabaseAdmin
    .from('playlists')
    .insert(payload as never)
    .select(PLAYLIST_SELECT)
    .single()

  if (error) {
    throw new Error(`playlists insert failed: ${error.message}`)
  }

  revalidatePlaylistPaths((data as Playlist).id)
  return data as Playlist
}

export async function updatePlaylist(
  playlistId: string,
  title: string,
  description: string | undefined,
  updatedAt: string,
) {
  const { user } = await requireRole(['editor', 'admin'])
  const normalizedPlaylistId = normalizeRequiredText(playlistId, 'playlistId が必要です')
  const normalizedUpdatedAt = normalizeRequiredText(updatedAt, 'updated_at が必要です')

  const payload: PlaylistUpdate = {
    title: normalizeRequiredText(title, 'タイトルを入力してください'),
    description: normalizeOptionalText(description),
    updated_by: user.id,
  }

  const result = await supabaseAdmin
    .from('playlists')
    .update(payload as never)
    .eq('id', normalizedPlaylistId)
    .eq('updated_at', normalizedUpdatedAt)
    .select(PLAYLIST_SELECT)
    .maybeSingle()

  if (result.error) {
    throw new Error(`playlists update failed: ${result.error.message}`)
  }

  if (!result.data) {
    const existing = await fetchPlaylistTimestamp(normalizedPlaylistId)
    if (!existing) {
      throw new Error('プレイリストが見つからない')
    }
    throw new Error('409 Conflict')
  }

  revalidatePlaylistPaths(normalizedPlaylistId)
  return result.data as Playlist
}

export async function deletePlaylist(playlistId: string, updatedAt?: string) {
  await requireRole(['editor', 'admin'])

  const normalizedPlaylistId = normalizeRequiredText(playlistId, 'playlistId が必要です')
  let deleteQuery = supabaseAdmin
    .from('playlists')
    .delete()
    .eq('id', normalizedPlaylistId)
    .select('id')

  if (updatedAt) {
    deleteQuery = deleteQuery.eq('updated_at', updatedAt)
  }

  const result = await deleteQuery.maybeSingle()

  if (result.error) {
    throw new Error(`playlists delete failed: ${result.error.message}`)
  }

  if (!result.data) {
    const existing = await fetchPlaylistTimestamp(normalizedPlaylistId)
    if (!existing) {
      throw new Error('プレイリストが見つからない')
    }
    throw new Error('409 Conflict')
  }

  revalidatePlaylistPaths(normalizedPlaylistId)
}

export async function addStreamToPlaylist(playlistId: string, videoId: string, updatedAt?: string) {
  const { user } = await requireRole(['editor', 'admin'])
  const normalizedPlaylistId = normalizeRequiredText(playlistId, 'playlistId が必要です')
  const normalizedVideoId = normalizeRequiredText(videoId, 'videoId が必要です')

  await assertPlaylistLock(normalizedPlaylistId, updatedAt)

  const streamResult = await supabaseAdmin
    .from('streams')
    .select('id')
    .eq('video_id', normalizedVideoId)
    .maybeSingle()

  if (streamResult.error) {
    throw new Error(`streams lookup failed: ${streamResult.error.message}`)
  }

  const stream = streamResult.data as StreamIdRow | null

  if (!stream) {
    throw new Error('配信が見つからない')
  }

  const maxPositionResult = await supabaseAdmin
    .from('playlist_streams')
    .select('position')
    .eq('playlist_id', normalizedPlaylistId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (maxPositionResult.error) {
    throw new Error(`playlist_streams lookup failed: ${maxPositionResult.error.message}`)
  }

  const maxPositionRow = maxPositionResult.data as StreamPositionRow | null
  const basePosition = maxPositionRow?.position ? Number(maxPositionRow.position) : 0
  const nextPosition = (basePosition + 10000).toFixed(8)

  const payload: PlaylistStreamInsert = {
    playlist_id: normalizedPlaylistId,
    stream_id: stream.id,
    position: nextPosition,
    added_by: user.id,
  }

  const insertResult: { data: unknown; error: PostgrestErrorLike | null } = await supabaseAdmin
    .from('playlist_streams')
    .insert(payload as never)
    .select(PLAYLIST_STREAM_SELECT)
    .single()

  if (insertResult.error) {
    if (isUniqueViolation(insertResult.error)) {
      throw new Error('既に追加済み')
    }

    throw new Error(`playlist_streams insert failed: ${insertResult.error.message}`)
  }

  const nextUpdatedAt = await touchPlaylist(normalizedPlaylistId, user.id)
  revalidatePlaylistPaths(normalizedPlaylistId)

  return {
    playlistStream: insertResult.data as PlaylistStream,
    updatedAt: nextUpdatedAt,
  }
}

export async function removeStreamFromPlaylist(
  playlistStreamId: string,
  playlistId: string,
  updatedAt?: string,
) {
  const { user } = await requireRole(['editor', 'admin'])
  const normalizedPlaylistStreamId = normalizeRequiredText(playlistStreamId, 'playlistStreamId が必要です')
  const normalizedPlaylistId = normalizeRequiredText(playlistId, 'playlistId が必要です')

  await assertPlaylistLock(normalizedPlaylistId, updatedAt)

  const { error, count } = await supabaseAdmin
    .from('playlist_streams')
    .delete({ count: 'exact' })
    .eq('id', normalizedPlaylistStreamId)
    .eq('playlist_id', normalizedPlaylistId)

  if (error) {
    throw new Error(`playlist_streams delete failed: ${error.message}`)
  }

  if ((count ?? 0) === 0) {
    throw new Error('プレイリスト内の動画が見つからない')
  }

  const nextUpdatedAt = await touchPlaylist(normalizedPlaylistId, user.id)
  revalidatePlaylistPaths(normalizedPlaylistId)

  return {
    updatedAt: nextUpdatedAt,
  }
}

export async function reorderPlaylistStream(
  playlistId: string,
  streamId: string,
  newPosition: number,
  updatedAt?: string,
) {
  const { user } = await requireRole(['editor', 'admin'])
  const normalizedPlaylistId = normalizeRequiredText(playlistId, 'playlistId が必要です')
  const normalizedStreamId = normalizeRequiredText(streamId, 'streamId が必要です')

  if (!Number.isFinite(newPosition)) {
    throw new Error('newPosition が不正です')
  }

  await assertPlaylistLock(normalizedPlaylistId, updatedAt)

  const rpcResult = await (
    supabaseAdmin as typeof supabaseAdmin & {
      rpc: (
        fn: 'reorder_playlist_stream',
        args: {
          p_playlist_id: string
          p_stream_id: string
          p_new_position: number
        },
      ) => Promise<{ data: unknown; error: PostgrestErrorLike | null }>
    }
  ).rpc('reorder_playlist_stream', {
    p_playlist_id: normalizedPlaylistId,
    p_stream_id: normalizedStreamId,
    p_new_position: newPosition,
  })

  if (rpcResult.error) {
    if (isUniqueViolation(rpcResult.error)) {
      throw new Error('並び替えに失敗した。再試行してください')
    }

    throw new Error(`reorder_playlist_stream failed: ${rpcResult.error.message}`)
  }

  const nextUpdatedAt = await touchPlaylist(normalizedPlaylistId, user.id)
  revalidatePlaylistPaths(normalizedPlaylistId)

  return {
    updatedAt: nextUpdatedAt,
  }
}

export async function toggleBookmark(streamId: string) {
  const { user } = await requireRole(['editor', 'admin'])
  const normalizedStreamId = normalizeRequiredText(streamId, 'streamId が必要です')

  const existingResult = await supabaseAdmin
    .from('bookmarks')
    .select('stream_id')
    .eq('user_id', user.id)
    .eq('stream_id', normalizedStreamId)
    .maybeSingle()

  if (existingResult.error) {
    throw new Error(`bookmarks lookup failed: ${existingResult.error.message}`)
  }

  if (existingResult.data) {
    const { error } = await supabaseAdmin
      .from('bookmarks')
      .delete()
      .eq('user_id', user.id)
      .eq('stream_id', normalizedStreamId)

    if (error) {
      throw new Error(`bookmarks delete failed: ${error.message}`)
    }

    revalidatePath('/member')
    return { bookmarked: false }
  }

  const payload: BookmarkInsert = {
    user_id: user.id,
    stream_id: normalizedStreamId,
  }

  const toggleResult: { error: PostgrestErrorLike | null } = await supabaseAdmin
    .from('bookmarks')
    .upsert(payload as never, { onConflict: 'user_id,stream_id' })

  if (toggleResult.error) {
    throw new Error(`bookmarks upsert failed: ${toggleResult.error.message}`)
  }

  revalidatePath('/member')
  return { bookmarked: true }
}

export async function fetchBookmarkedStreams(filters?: {
  query?: string
  tags?: string[]
  corners?: string[]
}) {
  const { user } = await requireRole(['editor', 'admin'])
  const queryText = filters?.query?.trim() ?? ''

  if (!queryText) {
    const result = await buildBookmarkedStreamsQuery(user.id, filters)

    if (result.error) {
      throw new Error(`bookmarked streams fetch failed: ${result.error.message}`)
    }

    return ((result.data ?? []) as BookmarkedStreamRow[]).map(stripBookmarkRelation)
  }

  const pattern = `%${queryText}%`
  const [titleResult, summaryResult] = await Promise.all([
    buildBookmarkedStreamsQuery(user.id, filters).ilike('title', pattern),
    buildBookmarkedStreamsQuery(user.id, filters).ilike('summary', pattern),
  ])

  if (titleResult.error) {
    throw new Error(`bookmarked streams title search failed: ${titleResult.error.message}`)
  }

  if (summaryResult.error) {
    throw new Error(`bookmarked streams summary search failed: ${summaryResult.error.message}`)
  }

  const merged = new Map<string, MemberBookmarkedStream>()

  for (const row of [...(titleResult.data ?? []), ...(summaryResult.data ?? [])] as BookmarkedStreamRow[]) {
    merged.set(row.id, stripBookmarkRelation(row))
  }

  return [...merged.values()]
}

export async function submitEntityWordRequest(entityId: string, word: string) {
  const { user } = await requireRole(['editor', 'admin'])

  const payload: EntityWordRequestInsert = {
    entity_id: normalizeRequiredText(entityId, 'entityId が必要です'),
    word: normalizeRequiredText(word, '単語を入力してください'),
    requested_by: user.id,
    reviewed_by: null,
  }

  const result: { data: unknown; error: PostgrestErrorLike | null } = await supabaseAdmin
    .from('entity_word_requests')
    .insert(payload as never)
    .select(ENTITY_WORD_REQUEST_SELECT)
    .single()

  if (result.error) {
    if (isUniqueViolation(result.error)) {
      throw new Error('申請済み')
    }

    throw new Error(`entity_word_requests insert failed: ${result.error.message}`)
  }

  const request = result.data as EntityWordRequest
  revalidateEntityRequestPaths(request.entity_id)
  return request
}

export async function approveEntityWordRequest(requestId: string) {
  const { user } = await requireRole(['admin'])
  const normalizedRequestId = normalizeRequiredText(requestId, 'requestId が必要です')
  const reviewedAt = new Date().toISOString()

  // TODO: ここは SECURITY DEFINER RPC に寄せる。現状の service-role 連続実行では
  // request 行ロックと entities 行ロックを同一トランザクションで扱えない。
  const approveResult = await supabaseAdmin
    .from('entity_word_requests')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: reviewedAt,
    } as never)
    .eq('id', normalizedRequestId)
    .eq('status', 'pending')
    .select(ENTITY_WORD_REQUEST_SELECT)
    .maybeSingle()

  if (approveResult.error) {
    throw new Error(`entity_word_requests approve failed: ${approveResult.error.message}`)
  }

  const approvedRequest = approveResult.data as EntityWordRequest | null

  if (!approvedRequest) {
    throw new Error('既に処理済み')
  }

  const entityResult = await supabaseAdmin
    .from('entities')
    .select('id, match_names')
    .eq('id', approvedRequest.entity_id)
    .maybeSingle()

  if (entityResult.error) {
    throw new Error(`entities lookup failed: ${entityResult.error.message}`)
  }

  const entity = entityResult.data as EntityMatchNamesRow | null

  if (!entity) {
    throw new Error('エンティティが見つからない')
  }

  if (!entity.match_names.includes(approvedRequest.word)) {
    const { error } = await supabaseAdmin
      .from('entities')
      .update({
        match_names: [...entity.match_names, approvedRequest.word],
      } as never)
      .eq('id', entity.id)

    if (error) {
      throw new Error(`entities update failed: ${error.message}`)
    }
  }

  revalidateEntityRequestPaths(approvedRequest.entity_id)
  return approvedRequest
}

export async function rejectEntityWordRequest(requestId: string) {
  const { user } = await requireRole(['admin'])
  const normalizedRequestId = normalizeRequiredText(requestId, 'requestId が必要です')

  const result = await supabaseAdmin
    .from('entity_word_requests')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq('id', normalizedRequestId)
    .eq('status', 'pending')
    .select(ENTITY_WORD_REQUEST_SELECT)
    .maybeSingle()

  if (result.error) {
    throw new Error(`entity_word_requests reject failed: ${result.error.message}`)
  }

  const rejectedRequest = result.data as EntityWordRequest | null

  if (!rejectedRequest) {
    throw new Error('既に処理済み')
  }

  revalidateEntityRequestPaths(rejectedRequest.entity_id)
  return rejectedRequest
}
