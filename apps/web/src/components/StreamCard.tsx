'use client'

import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, useState, useTransition } from 'react'
import { toggleBookmark } from '@/app/member/actions'
import { getTagLabel } from '@/lib/tag-labels'
import type { Stream } from '@/lib/types'

type StreamCardStream = Pick<
  Stream,
  | 'id'
  | 'video_id'
  | 'title'
  | 'stream_date'
  | 'duration_min'
  | 'thumbnail_url'
  | 'summary'
  | 'view_count'
  | 'comment_count'
  | 'tags'
  | 'corner_names'
> & {
  chapters: { stream_id: string }[] | null
}

type Props = {
  stream: StreamCardStream
  rank?: number
  onFilterSelect?: (kind: 'tag' | 'corner', value: string) => void
  currentUserId?: string | null
  isBookmarked?: boolean
}

const SUMMARY_PREVIEW_LENGTH = 110

function ActionButton({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-raised)] text-lg text-[var(--ink)] transition hover:border-[var(--aqua)]"
    >
      {children}
    </Link>
  )
}

export default function StreamCard({
  stream,
  rank,
  onFilterSelect,
  currentUserId,
  isBookmarked = false,
}: Props) {
  const [bookmarked, setBookmarked] = useState(isBookmarked)
  const [bookmarkPending, startBookmarkTransition] = useTransition()

  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const cornerSet = new Set(stream.corner_names ?? [])
  const tagsOnly = (stream.tags ?? []).filter((tag) => !cornerSet.has(tag))
  const showMemberActions = Boolean(currentUserId)
  const youtubeUrl = `https://www.youtube.com/watch?v=${stream.video_id}`
  const filterItems = [
    ...(stream.corner_names ?? []).map((value) => ({ kind: 'corner' as const, value, label: value })),
    ...tagsOnly.map((value) => ({ kind: 'tag' as const, value, label: getTagLabel(value) })),
  ]
  const summaryPreview = stream.summary
    ? stream.summary.slice(0, SUMMARY_PREVIEW_LENGTH) + (stream.summary.length > SUMMARY_PREVIEW_LENGTH ? '…' : '')
    : null

  function handleBookmarkClick() {
    const nextBookmarked = !bookmarked
    setBookmarked(nextBookmarked)

    startBookmarkTransition(async () => {
      try {
        const result = await toggleBookmark(stream.id)
        setBookmarked(result.bookmarked)
      } catch {
        setBookmarked(!nextBookmarked)
      }
    })
  }

  return (
    <article className="stream-card group overflow-hidden rounded-2xl border">
      <div className="relative">
        <div className="relative aspect-video overflow-hidden bg-[var(--surface-raised)]">
          {stream.thumbnail_url ? (
            <Link
              href={`/stream/${stream.video_id}`}
              aria-label={`${stream.title}の要点・チャプターを見る`}
              className="block h-full w-full cursor-pointer"
            >
              <Image
                src={stream.thumbnail_url}
                alt={stream.title}
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition duration-200 group-hover:scale-[1.015]"
              />
            </Link>
          ) : (
            <div className="flex h-full flex-col justify-between p-4 text-[var(--muted)]">
              <span className="text-[10px] font-medium tracking-[0.14em]">NO THUMBNAIL</span>
              <span className="line-clamp-2 text-sm">{stream.title}</span>
            </div>
          )}
          {rank !== undefined && rank <= 3 && (
            <span className="absolute left-3 top-3 font-mono text-2xl font-semibold tabular-nums text-[var(--ink)]">{String(rank).padStart(2, '0')}</span>
          )}
          <div className="absolute left-3 top-3 rounded-full bg-black/65 px-2 py-1 text-[11px] text-white">{date}</div>
          {stream.duration_min != null && <div className="absolute right-3 top-3 rounded-full bg-black/65 px-2 py-1 text-[11px] text-white">{stream.duration_min}分</div>}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {filterItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filterItems.slice(0, 2).map((item) => (
              <button key={`${item.kind}:${item.value}`} type="button" onClick={() => onFilterSelect?.(item.kind, item.value)} className="inline-flex min-h-7 items-center rounded-full border border-[var(--line)] px-2 text-xs text-[var(--muted)] transition hover:border-[var(--aqua)] hover:text-[var(--ink)]">{item.label}</button>
            ))}
            {filterItems.length > 2 && <span className="inline-flex min-h-7 items-center rounded-full border border-[var(--line)] px-2 text-xs text-[var(--muted)]">+{filterItems.length - 2}</span>}
          </div>
        )}
        <h2 className="line-clamp-2 text-base font-semibold leading-snug text-[var(--ink)]">{stream.title}</h2>
        <p className="font-mono text-xs tabular-nums text-[var(--muted)]">
          {date}{stream.view_count != null && ` ・ 再生 ${stream.view_count.toLocaleString()}`}{stream.chapters?.length ? ` ・ チャプター ${stream.chapters.length}` : ''}
        </p>
        {summaryPreview && <p className="text-sm leading-7 text-[var(--muted)]">{summaryPreview}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--signal)] px-4 text-sm font-semibold text-[#08111D] transition hover:brightness-110">YouTubeで開く ↗</a>
          <Link href={`/stream/${stream.video_id}`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--line)] px-4 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--aqua)]">要点・チャプターを見る →</Link>
        </div>
        {showMemberActions && (
          <div className="flex items-center gap-2 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              aria-label={bookmarked ? 'ブックマーク解除' : 'ブックマーク'}
              title={bookmarked ? 'ブックマーク解除' : 'ブックマーク'}
              disabled={bookmarkPending}
              onClick={handleBookmarkClick}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] text-lg text-[var(--muted)] transition hover:border-[var(--aqua)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {bookmarked ? '♥' : '♡'}
            </button>
            <ActionButton href={`/member?addStream=${stream.id}`} label="プレイリストに追加">＋</ActionButton>
          </div>
        )}
      </div>
    </article>
  )
}
