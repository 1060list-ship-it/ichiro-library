import Link from 'next/link'
import type { Stream } from '@/lib/types'

type Props = { stream: Stream; rank?: number }

export default function StreamCard({ stream, rank }: Props) {
  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Link href={`/stream/${stream.video_id}`} className="block">
      <div className="rounded-lg bg-gray-900 border border-gray-800 overflow-hidden hover:border-gray-600 transition-colors">
        {stream.thumbnail_url && (
          <div className="relative">
            <img
              src={stream.thumbnail_url}
              alt={stream.title}
              className="w-full aspect-video object-cover"
            />
            {rank !== undefined && (
              <div className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/70">
                <span className={`text-sm font-bold ${rank <= 3 ? 'text-yellow-400' : 'text-gray-300'}`}>
                  {rank}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="p-3 space-y-1.5">
          <p className="text-xs text-gray-400">{date}</p>
          <h2 className="font-medium leading-snug line-clamp-2">{stream.title}</h2>
          {stream.summary && (
            <p className="text-sm text-gray-400 line-clamp-2">{stream.summary}</p>
          )}
          <div className="flex items-center gap-3 pt-0.5">
            {stream.view_count != null && (
              <span className="text-xs text-gray-500">再生 {stream.view_count.toLocaleString()}</span>
            )}
            {stream.comment_count != null && (
              <span className="text-xs text-gray-500">コメント {stream.comment_count.toLocaleString()}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {stream.tags?.slice(0, 4).map(tag => (
              <span key={tag} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  )
}
