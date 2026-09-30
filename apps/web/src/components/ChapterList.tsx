import type { Chapter } from '@/lib/types'

type ChapterListItem = Pick<Chapter, 'id' | 'start_sec' | 'title' | 'summary'>

type Props = {
  chapters: ChapterListItem[]
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
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--ink)]">チャプター</h2>
      <div className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        {chapters.map(ch => (
          <a
            key={ch.id}
            href={`https://www.youtube.com/watch?v=${videoId}&t=${ch.start_sec}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${formatTime(ch.start_sec)}から「${ch.title}」をYouTubeで開く`}
            className="flex min-h-14 gap-3 px-4 py-3 transition hover:bg-[var(--surface-raised)]"
          >
            <span className="w-14 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-[var(--aqua)]">
              {formatTime(ch.start_sec)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--ink)]">{ch.title}</p>
              {ch.summary && <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{ch.summary}</p>}
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}
