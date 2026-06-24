import { notFound } from 'next/navigation'
import PlaylistPlayer from './PlaylistPlayer'
import { getCurrentUserRole } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Playlist, Stream } from '@/lib/types'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

type PlaylistStreamJoinRow = {
  stream_id: string
  streams: Stream | Stream[] | null
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
      .select('*')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('playlist_streams')
      .select('stream_id, streams(*)')
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

  const streams = ((streamRows ?? []) as PlaylistStreamJoinRow[])
    .map((row) => takeFirstRelation(row.streams))
    .filter((stream): stream is Stream => stream !== null)

  return (
    <PlaylistPlayer
      playlist={playlist as Playlist}
      streams={streams}
      role={role}
    />
  )
}
