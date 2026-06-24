import Link from 'next/link'
import type { Playlist } from '@/lib/types'

type PlaylistCardData = Playlist & {
  stream_count: number
  thumbnail_url: string | null
}

type Props = {
  playlist: PlaylistCardData
}

export default function PlaylistThumbnailCard({ playlist }: Props) {
  return (
    <Link href={`/playlist/${playlist.id}`} className="block">
      <article className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900 transition-colors hover:border-gray-600">
        {playlist.thumbnail_url ? (
          <img
            src={playlist.thumbnail_url}
            alt={playlist.title}
            className="w-full aspect-video object-cover"
          />
        ) : (
          <div className="w-full aspect-video bg-gray-800" aria-hidden="true" />
        )}

        <div className="space-y-2 p-3">
          <h2 className="line-clamp-2 font-medium leading-snug text-white">
            {playlist.title}
          </h2>
          <p className="line-clamp-2 text-sm text-gray-400">
            {playlist.description ?? '説明はまだありません。'}
          </p>
          <p className="text-xs text-gray-500">
            {playlist.stream_count.toLocaleString()}本の配信
          </p>
        </div>
      </article>
    </Link>
  )
}
