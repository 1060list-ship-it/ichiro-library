'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { linkifyEntities } from '@/lib/linkify'
import {
  PUBLIC_CHAPTER_LIST_SELECT,
  PUBLIC_ENTITY_LINK_SELECT,
  PUBLIC_STREAM_DETAIL_SELECT,
} from '@/lib/selects'
import type { Stream, Chapter, Highlight, Entity } from '@/lib/types'
import ChapterList from '@/components/ChapterList'

const REASON_COLORS: Record<string, string> = {
  '笑い':  'bg-yellow-900 text-yellow-300',
  '名言':  'bg-blue-900 text-blue-300',
  '感動':  'bg-pink-900 text-pink-300',
  '驚き':  'bg-orange-900 text-orange-300',
  '神回':  'bg-purple-900 text-purple-300',
}

type StreamDetail = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'duration_min' | 'view_count' | 'summary' | 'tags' | 'corner_names' | 'guests' | 'highlights'>
type ChapterListItem = Pick<Chapter, 'id' | 'start_sec' | 'title' | 'summary'>
type LinkableEntity = Pick<Entity, 'slug' | 'name' | 'match_names'>

function HighlightList({ highlights, videoId, entities }: { highlights: Highlight[]; videoId: string; entities: LinkableEntity[] }) {
  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-4 pb-2">
        <p className="text-xs text-gray-500 font-medium">盛り上がり</p>
      </div>
      <div className="divide-y divide-gray-800">
        {highlights.map((h, i) => {
          const mm = Math.floor(h.start_sec / 60)
          const ss = h.start_sec % 60
          const timestamp = `${mm}:${String(ss).padStart(2, '0')}`
          const url = `https://www.youtube.com/watch?v=${videoId}&t=${h.start_sec}`
          return (
            <div key={i}
              className="flex items-start gap-3 px-4 py-3 hover:bg-gray-800 transition-colors">
              <span className="text-xs text-gray-400 font-mono mt-0.5 flex-shrink-0">{timestamp}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${REASON_COLORS[h.reason] ?? 'bg-gray-800 text-gray-300'}`}>
                {h.reason}
              </span>
              <span className="text-sm text-gray-200 leading-snug flex-1">「{linkifyEntities(h.quote, entities)}」</span>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 flex-shrink-0 mt-0.5"
              >
                YouTube
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function StreamPage() {
  const { id } = useParams<{ id: string }>()
  const [stream, setStream] = useState<StreamDetail | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[]>([])
  const [entities, setEntities] = useState<LinkableEntity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from('streams').select(PUBLIC_STREAM_DETAIL_SELECT).eq('video_id', id).single() as { data: StreamDetail | null }
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

          if (entityData) setEntities(entityData as LinkableEntity[])
        }

        const { data: c } = await supabase
          .from('chapters')
          .select(PUBLIC_CHAPTER_LIST_SELECT)
          .eq('stream_id', s.id)
          .order('sort_order')
        if (c) setChapters(c as ChapterListItem[])
      }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">読み込み中...</div>
  if (!stream) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">配信が見つかりません</div>

  const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const youtubeUrl = `https://www.youtube.com/watch?v=${stream.video_id}`

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">← 一覧に戻る</Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* YouTube埋め込み */}
        <div className="aspect-video w-full">
          <iframe
            src={`https://www.youtube.com/embed/${stream.video_id}`}
            className="w-full h-full rounded-lg"
            allowFullScreen
          />
        </div>

        {/* メタデータ */}
        <div className="space-y-2">
          <p className="text-sm text-gray-400">{date}</p>
          <h1 className="text-lg font-bold leading-snug">{stream.title}</h1>
          <div>
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200"
            >
              YouTubeで全部見る ↗
            </a>
          </div>
          <div className="flex gap-4 text-sm text-gray-400">
            {stream.view_count && <span>再生 {stream.view_count.toLocaleString()}</span>}
            {stream.duration_min && <span>{stream.duration_min}分</span>}
          </div>
        </div>

        {/* タグ */}
        {(stream.tags?.length || stream.corner_names?.length || stream.guests?.length) ? (
          <div className="flex flex-wrap gap-2">
            {stream.corner_names?.map(c => (
              <span key={c} className="text-xs bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded-full">{c}</span>
            ))}
            {stream.guests?.map(g => (
              <span key={g} className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full">{linkifyEntities(g, entities)}</span>
            ))}
            {stream.tags?.map(t => (
              <span key={t} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        ) : null}

        {/* AI要約 */}
        {stream.summary && (
          <div className="bg-gray-900 rounded-lg p-4 space-y-1">
            <p className="text-xs text-gray-500 font-medium">AI要約</p>
            <p className="text-sm text-gray-200 leading-relaxed">{linkifyEntities(stream.summary, entities)}</p>
            <button
              type="button"
              onClick={() => console.log('stream-summary-report', { videoId: stream.video_id, title: stream.title })}
              className="pt-2 text-xs text-rose-300 transition hover:text-rose-200"
            >
              この要約の内容が違う
            </button>
          </div>
        )}

        {/* チャプター */}
        {chapters.length > 0 && <ChapterList chapters={chapters} videoId={stream.video_id} />}

        {/* 盛り上がり */}
        {stream.highlights && stream.highlights.length > 0 && (
          <HighlightList highlights={stream.highlights} videoId={stream.video_id} entities={entities} />
        )}

        <div className="border-t border-gray-800 pt-2">
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full border border-gray-700 px-4 py-2 text-sm font-semibold text-white transition hover:border-gray-500 hover:bg-gray-900"
          >
            YouTubeで全部見る ↗
          </a>
        </div>
      </div>
    </main>
  )
}
