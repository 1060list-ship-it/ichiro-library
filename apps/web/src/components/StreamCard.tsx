import Link from 'next/link'
import type { Stream } from '@/lib/types'

type Props = { stream: Stream; rank?: number }

export default function StreamCard({ stream, rank }: Props) {
  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Link href={`/stream/${stream.video_id}`} className="block">
      <div className="flex gap-3 rounded-lg bg-gray-900 border border-gray-800 p-4 hover:border-gray-600 transition-colors">
        {rank !== undefined && (
          <div className="flex-shrink-0 w-7 text-center">
            <span className={`text-sm font-bold ${rank <= 3 ? 'text-yellow-400' : 'text-gray-500'}`}>
              {rank}
            </span>
          </div>
        )}
        {stream.thumbnail_url && (
          <img
            src={stream.thumbnail_url}
            alt={stream.title}
            className="w-32 h-20 object-cover rounded flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs text-gray-400">{date}</p>
          <h2 className="font-medium leading-snug line-clamp-2">{stream.title}</h2>
          {stream.summary && (
            <p className="text-sm text-gray-400 line-clamp-2">{stream.summary}</p>
          )}
          <div className="flex items-center gap-3 pt-0.5">
            {stream.view_count != null && stream.like_count != null && (
              <span className="text-xs font-medium text-yellow-400">
                支持率 {((stream.like_count / stream.view_count) * 100).toFixed(1)}%
              </span>
            )}
            {stream.view_count != null && (
              <span className="text-xs text-gray-500">再生 {stream.view_count.toLocaleString()}</span>
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
