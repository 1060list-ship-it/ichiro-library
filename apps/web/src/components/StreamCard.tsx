'use client'

import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, useState, useTransition } from 'react'
import { toggleBookmark } from '@/app/member/actions'
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
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-black/70 text-lg text-white shadow-lg shadow-black/30 backdrop-blur transition hover:border-cyan-400/60 hover:text-cyan-200"
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
  const showUpdatingBadge = !stream.chapters || stream.chapters.length === 0
  const cornerSet = new Set(stream.corner_names ?? [])
  const tagsOnly = (stream.tags ?? []).filter((tag) => !cornerSet.has(tag))
  const showMemberActions = Boolean(currentUserId)

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
    <div className="group overflow-hidden rounded-lg border border-gray-800 bg-gray-900 transition-colors hover:border-gray-600">
      <div className="relative">
        <Link href={`/stream/${stream.video_id}`} className="block">
          {stream.thumbnail_url && (
            <div className="relative">
              <Image
                src={stream.thumbnail_url}
                alt={stream.title}
                fill
                sizes="(min-width: 640px) 50vw, 100vw"
                className="object-cover transition duration-300 group-hover:scale-[1.02]"
              />
              <div className="aspect-video w-full" />
              {rank !== undefined && (
                <div className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70">
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
          <div className="space-y-1.5 p-3">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400">{date}</p>
              {showUpdatingBadge && (
                <span className="rounded-full border border-sky-200/10 bg-sky-300/10 px-2 py-0.5 text-[10px] font-medium text-sky-100/70">
                  更新中
                </span>
              )}
            </div>
            <h2 className="pr-14 font-medium leading-snug line-clamp-2">{stream.title}</h2>
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

        {showMemberActions && (
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
            <button
              type="button"
              aria-label={bookmarked ? 'ブックマーク解除' : 'ブックマーク'}
              title={bookmarked ? 'ブックマーク解除' : 'ブックマーク'}
              disabled={bookmarkPending}
              onClick={handleBookmarkClick}
              className={`flex h-9 w-9 items-center justify-center rounded-full border bg-black/70 text-lg shadow-lg shadow-black/30 backdrop-blur transition ${
                bookmarked
                  ? 'border-rose-400/60 text-rose-300 hover:border-rose-300 hover:text-rose-200'
                  : 'border-white/12 text-white hover:border-rose-400/60 hover:text-rose-200'
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {bookmarked ? '♥' : '♡'}
            </button>
            <ActionButton href={`/member?addStream=${stream.id}`} label="プレイリストに追加">
              ＋
            </ActionButton>
          </div>
        )}
      </div>

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
