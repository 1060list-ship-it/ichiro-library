import type { Stream } from '@/lib/types'

type Props = {
  stream: Stream
  position: number
  isActive: boolean
  onClick: (videoId: string) => void
}

export default function PlaylistStreamRow({ stream, position, isActive, onClick }: Props) {
  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })

  return (
    <button
      type="button"
      onClick={() => onClick(stream.video_id)}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
        isActive ? 'bg-gray-800' : 'hover:bg-gray-900/80'
      }`}
    >
      <span className="w-6 shrink-0 pt-1 text-sm text-gray-500">
        {position}
      </span>

      {stream.thumbnail_url ? (
        <img
          src={stream.thumbnail_url}
          alt={stream.title}
          className="aspect-video w-20 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="aspect-video w-20 shrink-0 rounded bg-gray-800" aria-hidden="true" />
      )}

      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <p className="line-clamp-2 flex-1 font-medium leading-snug text-white">
          {stream.title}
        </p>

        <div className="shrink-0 text-right text-xs text-gray-500">
          <p>{stream.view_count != null ? `再生 ${stream.view_count.toLocaleString()}` : '再生数 -'}</p>
          <p>{date}</p>
        </div>
      </div>
    </button>
  )
}
