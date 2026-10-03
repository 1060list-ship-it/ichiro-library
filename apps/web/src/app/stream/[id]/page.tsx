'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { reportStreamSummary } from '../actions'
import { linkifyBody, linkifyExact } from '@/lib/linkify'
import { getTagLabel } from '@/lib/tag-labels'
import {
  PUBLIC_CHAPTER_LIST_SELECT,
  PUBLIC_ENTITY_LINK_SELECT,
  PUBLIC_STREAM_DETAIL_SELECT,
} from '@/lib/selects'
import type { Stream, Chapter, Entity } from '@/lib/types'
import ChapterList from '@/components/ChapterList'

type StreamDetail = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'duration_min' | 'view_count' | 'summary' | 'tags' | 'corner_names' | 'guests'>
type ChapterListItem = Pick<Chapter, 'id' | 'start_sec' | 'title' | 'summary'>
type LinkableEntity = Pick<Entity, 'slug' | 'name' | 'match_names'>

const REPORT_STORAGE_PREFIX = 'ichiro_reported_'
type ReportFailure = 'server' | 'storage' | null

export default function StreamPage() {
  const { id } = useParams<{ id: string }>()
  const [stream, setStream] = useState<StreamDetail | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[]>([])
  const [entities, setEntities] = useState<LinkableEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [reported, setReported] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportFailure, setReportFailure] = useState<ReportFailure>(null)
  const reportInFlight = useRef(false)

  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from('streams').select(PUBLIC_STREAM_DETAIL_SELECT).eq('video_id', id).single() as { data: StreamDetail | null }
      try {
        setReported(Boolean(localStorage.getItem(REPORT_STORAGE_PREFIX + id)))
      } catch {
        // Storage may be unavailable during initial load; keep the page usable
        // and let a successful submission establish the in-memory sent state.
        setReported(false)
      }
      if (s) {
        setStream(s)
        const { data: entityRows } = await supabase
          .from('stream_entities')
          .select('entity_id')
          .eq('stream_id', s.id)

        if (entityRows?.length) {
          const entityIds = (entityRows as unknown as { entity_id: string }[]).map((row) => row.entity_id)
          const { data: entityData } = await supabase
            .from('entities')
            .select(PUBLIC_ENTITY_LINK_SELECT)
            .in('id', entityIds)

          if (entityData) setEntities(entityData as unknown as LinkableEntity[])
        }

        const { data: c } = await supabase
          .from('chapters')
          .select(PUBLIC_CHAPTER_LIST_SELECT)
          .eq('stream_id', s.id)
          .order('sort_order')
        if (c) setChapters(c as unknown as ChapterListItem[])
      }
      setLoading(false)
    }
    load()
  }, [id])

  async function handleReport() {
    if (reported || reporting || reportInFlight.current) return

    reportInFlight.current = true
    setReporting(true)
    setReportFailure(null)

    try {
      const result = await reportStreamSummary(id, navigator.userAgent)
      if (!result.ok) {
        setReportFailure('server')
        return
      }

      setReported(true)
      try {
        localStorage.setItem(REPORT_STORAGE_PREFIX + id, '1')
      } catch {
        // The request reached the server, but this browser cannot remember it for a future visit.
        setReportFailure('storage')
      }
    } catch {
      setReportFailure('server')
    } finally {
      reportInFlight.current = false
      setReporting(false)
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">読み込み中...</div>
  if (!stream) return <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">配信が見つかりません</div>

  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const youtubeUrl = `https://www.youtube.com/watch?v=${stream.video_id}`

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-[var(--muted)] transition hover:text-[var(--ink)]">← 配信一覧に戻る</Link>
        <div className="space-y-4">
          <p className="font-mono text-xs tabular-nums text-[var(--muted)]">{date}{stream.duration_min != null && ` / ${stream.duration_min}分`}{stream.view_count != null && ` / 再生 ${stream.view_count.toLocaleString()}`}</p>
          <h1 className="text-2xl font-semibold leading-snug tracking-[-0.02em] sm:text-4xl">{stream.title}</h1>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-[var(--line)]">
          <iframe
            src={`https://www.youtube.com/embed/${stream.video_id}`}
            title={stream.title}
            className="h-full w-full"
            allowFullScreen
          />
        </div>
        <div className="space-y-2 text-sm leading-7 text-[var(--muted)]"><p>このページは配信を探すための案内です。続きはYouTubeで。</p><a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--aqua)]">YouTubeで続きから見る ↗</a></div>

        {/* タグ */}
        {(() => {
          const cornerSet = new Set(stream.corner_names ?? [])
          const tagsOnly = (stream.tags ?? []).filter((tag) => !cornerSet.has(tag))
          const hasAny = cornerSet.size > 0 || tagsOnly.length > 0 || (stream.guests?.length ?? 0) > 0
          if (!hasAny) return null

          return (
            <div className="flex flex-wrap gap-2">
              {stream.corner_names?.map((cornerName) => (
                <Link
                  key={cornerName}
                  href={`/?corner=${encodeURIComponent(cornerName)}`}
                  className="min-h-7 rounded-full border border-[var(--line)] px-2 text-xs text-[var(--muted)] transition hover:border-[var(--aqua)]"
                >
                  {cornerName}
                </Link>
              ))}
              {stream.guests?.map((guest) => (
                <span key={guest} className="inline-flex min-h-7 items-center rounded-full border border-[var(--line)] px-2 text-xs text-[var(--muted)]">{linkifyExact(guest, entities)}</span>
              ))}
              {/* Phase 2でタグ絞り込みを実装する際は、生のtag値ではなくslug正規化したキーで統一すること（レガシー日本語タグとの分裂を防ぐ） */}
              {tagsOnly.map((tag) => (
                <Link
                  key={tag}
                  href={`/?tag=${encodeURIComponent(tag)}`}
                  className="min-h-7 rounded-full border border-[var(--line)] px-2 text-xs text-[var(--muted)] transition hover:border-[var(--aqua)]"
                >
                  {getTagLabel(tag)}
                </Link>
              ))}
            </div>
          )
        })()}

        {stream.summary && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">見どころ</h2>
            <div className="space-y-1 rounded-2xl bg-[var(--surface)] p-4">
            <p className="text-sm leading-7 text-[var(--ink)]">{linkifyBody(stream.summary, entities)}</p>
            <div className="pt-2 space-y-1">
              {!reported && !reporting && (
                <p className="text-xs text-[var(--muted)]">要約が気になる場合はお知らせください。</p>
              )}
              {reportFailure === 'server' && (
                <p role="alert" className="text-xs text-[var(--signal)]">送信に失敗しました。時間をおいて、もう一度お試しください。</p>
              )}
              {reportFailure === 'storage' && (
                <p role="alert" className="text-xs text-[var(--muted)]">依頼は送信されましたが、この端末には記録できませんでした。</p>
              )}
              <button
                type="button"
                onClick={() => void handleReport()}
                disabled={reported || reporting}
                className="min-h-11 text-xs text-[var(--muted)] transition hover:text-[var(--ink)] disabled:cursor-default disabled:opacity-50"
              >
                {reported ? '依頼済み' : reporting ? '送信中...' : '修正を依頼する'}
              </button>
            </div>
            </div>
          </section>
        )}

        {/* チャプター */}
        {chapters.length > 0 && <ChapterList chapters={chapters} videoId={stream.video_id} />}
      </div>
    </main>
  )
}
