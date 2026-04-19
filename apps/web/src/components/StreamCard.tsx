import Link from 'next/link'
import type { Stream } from '@/lib/types'

type Props = { stream: Stream }

export default function StreamCard({ stream }: Props) {
  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Link href={`/stream/${stream.video_id}`} className="block">
      <div className="flex gap-4 rounded-lg bg-gray-900 border border-gray-800 p-4 hover:border-gray-600 transition-colors">
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
          <div className="flex flex-wrap gap-1 pt-1">
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
