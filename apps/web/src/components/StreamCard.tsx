import Link from 'next/link'
import type { Stream } from '@/lib/types'

type StreamCardStream = Pick<Stream, 'video_id' | 'title' | 'stream_date' | 'duration_min' | 'thumbnail_url' | 'summary' | 'view_count' | 'comment_count' | 'tags' | 'corner_names'>
type Props = {
  stream: StreamCardStream
  rank?: number
  onFilterSelect?: (kind: 'tag' | 'corner', value: string) => void
}

export default function StreamCard({ stream, rank, onFilterSelect }: Props) {
  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const cornerSet = new Set(stream.corner_names ?? [])
  const tagsOnly = (stream.tags ?? []).filter((tag) => !cornerSet.has(tag))

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden transition-colors hover:border-gray-600">
      <Link href={`/stream/${stream.video_id}`} className="block">
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
            {stream.duration_min != null && (
              <div className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-1 text-[11px] font-medium text-white">
                {stream.duration_min}分
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
        </div>
      </Link>
      {(stream.corner_names?.length || tagsOnly.length) ? (
        <div className="flex flex-wrap gap-1 border-t border-gray-800 px-3 pb-3 pt-1.5">
          {stream.corner_names?.slice(0, 3).map((cornerName) => (
            <button
              key={cornerName}
              type="button"
              onClick={() => onFilterSelect?.('corner', cornerName)}
              className="rounded-full bg-indigo-950 px-2 py-0.5 text-xs text-indigo-300 transition hover:bg-indigo-900 hover:text-indigo-200"
            >
              {cornerName}
            </button>
          ))}
          {tagsOnly.slice(0, 4).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onFilterSelect?.('tag', tag)}
              className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300 transition hover:bg-gray-700 hover:text-white"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
