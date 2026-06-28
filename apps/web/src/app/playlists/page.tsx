import Link from 'next/link'
import PlaylistThumbnailCard from '@/components/PlaylistThumbnailCard'
import { PUBLIC_PLAYLIST_LIST_SELECT } from '@/lib/selects'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Playlist } from '@/lib/types'

type PlaylistStreamCountRow = {
  playlist_id: string
}

type PlaylistCardData = PlaylistListItem & {
  stream_count: number
}

type PlaylistListItem = Pick<Playlist, 'id' | 'title' | 'description' | 'created_at'>


export default async function PlaylistsPage() {
  const supabase = await createSupabaseServerClient()

  const { data: playlists, error: playlistsError } = await supabase
    .from('playlists')
    .select(PUBLIC_PLAYLIST_LIST_SELECT)
    .order('updated_at', { ascending: false })

  if (playlistsError) {
    throw new Error(`playlists fetch failed: ${playlistsError.message}`)
  }

  const playlistRows = (playlists ?? []) as PlaylistListItem[]

  let playlistCards: PlaylistCardData[] = []

  if (playlistRows.length > 0) {
    const { data: streamRows, error: streamRowsError } = await supabase
      .from('playlist_streams')
      .select('playlist_id')
      .in('playlist_id', playlistRows.map((playlist) => playlist.id))

    if (streamRowsError) {
      throw new Error(`playlist_streams fetch failed: ${streamRowsError.message}`)
    }

    const countByPlaylist = new Map<string, number>()

    for (const row of (streamRows ?? []) as PlaylistStreamCountRow[]) {
      countByPlaylist.set(row.playlist_id, (countByPlaylist.get(row.playlist_id) ?? 0) + 1)
    }

    playlistCards = playlistRows.map((playlist) => ({
      ...playlist,
      stream_count: countByPlaylist.get(playlist.id) ?? 0,
    }))
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-sm text-gray-400 transition hover:text-white">
            ← トップへ戻る
          </Link>
          <Link href="/member" className="text-xs text-gray-500 transition hover:text-gray-300">
            member
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <h1 className="text-xl font-bold mb-6">プレイリスト</h1>

        {playlistCards.length === 0 ? (
          <p className="text-gray-400">まだプレイリストがありません</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {playlistCards.map((playlist) => (
              <PlaylistThumbnailCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
