import Link from 'next/link'
import { requireRoleOrRedirect } from '@/lib/auth'
import { logoutAction } from '@/lib/auth-actions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Entity, EntityWordRequest, Playlist, PlaylistStream, Stream } from '@/lib/types'
import MemberPageClient from './MemberPageClient'

const MEMBER_PLAYLIST_SELECT = [
  'id',
  'title',
  'description',
  'created_at',
  'updated_at',
].join(', ')

const MEMBER_STREAM_SELECT = [
  'id',
  'video_id',
  'title',
  'stream_date',
  'tags',
  'corner_names',
].join(', ')

const MEMBER_ENTITY_SELECT = [
  'id',
  'name',
].join(', ')

const MEMBER_ENTITY_REQUEST_SELECT = [
  'id',
  'entity_id',
  'word',
  'status',
  'requested_by',
  'reviewed_by',
  'requested_at',
  'reviewed_at',
].join(', ')

type MemberPlaylist = Pick<Playlist, 'id' | 'title' | 'description' | 'created_at' | 'updated_at'> & {
  items: MemberPlaylistItem[]
}

type MemberPlaylistItem = Pick<PlaylistStream, 'id' | 'playlist_id' | 'stream_id' | 'position' | 'added_at'> & {
  stream: Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'tags' | 'corner_names'>
}

type PlaylistListItem = Pick<Playlist, 'id' | 'title' | 'description' | 'created_at' | 'updated_at'>
type MemberStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'tags' | 'corner_names'>
type MemberEntity = Pick<Entity, 'id' | 'name'>
type MemberEntityRequest = Pick<
  EntityWordRequest,
  'id' | 'entity_id' | 'word' | 'status' | 'requested_by' | 'reviewed_by' | 'requested_at' | 'reviewed_at'
>
type PlaylistStreamJoinRow = Pick<PlaylistStream, 'id' | 'playlist_id' | 'stream_id' | 'position' | 'added_at'> & {
  streams: MemberStream | MemberStream[] | null
}

function takeFirstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

export default async function MemberPage() {
  const session = await requireRoleOrRedirect(['editor', 'admin'], '/member')

  const email = session.user?.email ?? 'unknown'
  const currentUser = {
    id: session.user.id,
    email,
  }

  const { data: playlists, error: playlistsError } = await supabaseAdmin
    .from('playlists')
    .select(MEMBER_PLAYLIST_SELECT)
    .order('updated_at', { ascending: false })

  if (playlistsError) {
    throw new Error(`member playlists fetch failed: ${playlistsError.message}`)
  }

  const playlistRows = (playlists ?? []) as PlaylistListItem[]
  const playlistIds = playlistRows.map((playlist) => playlist.id)
  const playlistItemsById = new Map<string, MemberPlaylistItem[]>()

  if (playlistIds.length > 0) {
    const { data: playlistStreamRows, error: playlistStreamError } = await supabaseAdmin
      .from('playlist_streams')
      .select(`id, playlist_id, stream_id, position, added_at, streams(${MEMBER_STREAM_SELECT})`)
      .in('playlist_id', playlistIds)
      .order('playlist_id', { ascending: true })
      .order('position', { ascending: true })

    if (playlistStreamError) {
      throw new Error(`member playlist streams fetch failed: ${playlistStreamError.message}`)
    }

    for (const row of (playlistStreamRows ?? []) as PlaylistStreamJoinRow[]) {
      const stream = takeFirstRelation(row.streams)

      if (!stream) {
        continue
      }

      const items = playlistItemsById.get(row.playlist_id) ?? []
      items.push({
        id: row.id,
        playlist_id: row.playlist_id,
        stream_id: row.stream_id,
        position: row.position,
        added_at: row.added_at,
        stream,
      })
      playlistItemsById.set(row.playlist_id, items)
    }
  }

  const initialPlaylists: MemberPlaylist[] = playlistRows.map((playlist) => ({
    ...playlist,
    items: playlistItemsById.get(playlist.id) ?? [],
  }))

  const [{ data: entities, error: entitiesError }, requestResult] = await Promise.all([
    supabaseAdmin
      .from('entities')
      .select(MEMBER_ENTITY_SELECT)
      .order('name', { ascending: true }),
    session.role === 'admin'
      ? supabaseAdmin
        .from('entity_word_requests')
        .select(MEMBER_ENTITY_REQUEST_SELECT)
        .order('requested_at', { ascending: false })
      : supabaseAdmin
        .from('entity_word_requests')
        .select(MEMBER_ENTITY_REQUEST_SELECT)
        .eq('requested_by', session.user.id)
        .order('requested_at', { ascending: false }),
  ])

  if (entitiesError) {
    throw new Error(`member entities fetch failed: ${entitiesError.message}`)
  }

  if (requestResult.error) {
    throw new Error(`member entity requests fetch failed: ${requestResult.error.message}`)
  }

  const initialEntities = (entities ?? []) as MemberEntity[]
  const initialRequests = (requestResult.data ?? []) as MemberEntityRequest[]

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 md:px-6 md:py-8">
        <header className="flex flex-col gap-4 rounded-[28px] border border-gray-800 bg-gray-900 p-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="text-sm text-gray-400 transition hover:text-white"
              >
                ← トップへ戻る
              </Link>
              <span className="rounded-full border border-indigo-900/80 bg-indigo-950/40 px-3 py-1 text-xs font-medium text-indigo-200">
                member area
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                Member Console
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-gray-400">
                プレイリストの編集とエンティティ申請をまとめて触れる。触り心地まで含めて、ここを作業台にする。
              </p>
            </div>

            <dl className="grid gap-3 text-sm text-gray-300 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  role
                </dt>
                <dd className="mt-2 text-base font-medium text-white">{session.role}</dd>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  email
                </dt>
                <dd className="mt-2 break-all text-base font-medium text-white">{email}</dd>
              </div>
            </dl>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              ログアウト
            </button>
          </form>
        </header>

        <div className="mt-6">
          <MemberPageClient
            currentUser={currentUser}
            role={session.role}
            initialPlaylists={initialPlaylists}
            initialEntities={initialEntities}
            initialRequests={initialRequests}
          />
        </div>
      </div>
    </main>
  )
}
