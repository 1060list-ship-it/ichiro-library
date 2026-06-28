import { notFound } from 'next/navigation'
import PlaylistPlayer from './PlaylistPlayer'
import { getCurrentUserRole } from '@/lib/auth'
import { PUBLIC_PLAYLIST_LIST_SELECT, PUBLIC_STREAM_PLAYLIST_SELECT } from '@/lib/selects'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Playlist, Stream } from '@/lib/types'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

type PlaylistDetail = Pick<Playlist, 'id' | 'title' | 'description'>
type PlaylistPlayerStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'thumbnail_url' | 'view_count'>

type PlaylistStreamJoinRow = {
  stream_id: string
  streams: PlaylistPlayerStream | PlaylistPlayerStream[] | null
}

function takeFirstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

export default async function PlaylistDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [
    { data: playlist, error: playlistError },
    { data: streamRows, error: streamRowsError },
    role,
  ] = await Promise.all([
    supabase
      .from('playlists')
      .select(PUBLIC_PLAYLIST_LIST_SELECT)
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('playlist_streams')
      .select(`stream_id, streams(${PUBLIC_STREAM_PLAYLIST_SELECT})`)
      .eq('playlist_id', id)
      .order('position', { ascending: true }),
    getCurrentUserRole(),
  ])

  if (playlistError) {
    throw new Error(`playlist fetch failed: ${playlistError.message}`)
  }

  if (!playlist) {
    notFound()
  }

  if (streamRowsError) {
    throw new Error(`playlist streams fetch failed: ${streamRowsError.message}`)
  }

  const streams = ((streamRows ?? []) as unknown as PlaylistStreamJoinRow[])
    .map((row) => takeFirstRelation(row.streams))
    .filter((stream): stream is PlaylistPlayerStream => stream !== null)

  return (
    <PlaylistPlayer
      playlist={playlist as unknown as PlaylistDetail}
      streams={streams}
      role={role}
    />
  )
}
