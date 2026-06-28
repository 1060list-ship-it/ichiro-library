import Link from 'next/link'
import type { Playlist } from '@/lib/types'

type PlaylistCardData = Pick<Playlist, 'id' | 'title' | 'description'> & {
  stream_count: number
  earliest_stream_date: string | null
}

type Props = {
  playlist: PlaylistCardData
}

export default function PlaylistThumbnailCard({ playlist }: Props) {
  return (
    <Link href={`/playlist/${playlist.id}`} className="block">
      <article className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900 transition-colors hover:border-gray-600">
        <div className="space-y-2 p-3">
          <h2 className="line-clamp-2 font-medium leading-snug text-white">
            {playlist.title}
          </h2>
          <p className="line-clamp-2 text-sm text-gray-400">
            {playlist.description ?? '説明はまだありません。'}
          </p>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{playlist.stream_count.toLocaleString()}本</span>
            {playlist.earliest_stream_date && (
              <span>{new Date(playlist.earliest_stream_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })}〜</span>
            )}
          </div>
        </div>
      </article>
    </Link>
  )
}
