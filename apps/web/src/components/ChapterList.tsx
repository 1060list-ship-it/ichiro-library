import type { Chapter } from '@/lib/types'

type Props = {
  chapters: Chapter[]
  videoId: string
}

function formatTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function ChapterList({ chapters, videoId }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 font-medium">チャプター</p>
      <div className="divide-y divide-gray-800 rounded-lg bg-gray-900 overflow-hidden">
        {chapters.map(ch => (
          <a
            key={ch.id}
            href={`https://www.youtube.com/watch?v=${videoId}&t=${ch.start_sec}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 px-4 py-3 hover:bg-gray-800 transition-colors"
          >
            <span className="text-xs text-indigo-400 font-mono w-12 flex-shrink-0 pt-0.5">
              {formatTime(ch.start_sec)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{ch.title}</p>
              {ch.summary && <p className="text-xs text-gray-400 mt-0.5">{ch.summary}</p>}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
