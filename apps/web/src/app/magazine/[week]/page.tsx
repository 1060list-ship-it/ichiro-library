'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { linkifyEntities } from '@/lib/linkify'
import type { Entity } from '@/lib/types'

// -----------------------------------------------------------------------
// 型定義（kusanagiのstream_idsロジックと整合）
// -----------------------------------------------------------------------

type Highlight = {
  video_id: string
  quote: string
  reason: string
  start_sec: number
}

type Topic = {
  title: string
  body: string
  streams: { video_id: string; title: string; start_sec: number | null }[]
}

// 旧形式: string / 新形式: { title, video_id }
type Song = string | { title: string; video_id?: string }

type MagazineContent = {
  headline: string
  intro: string
  topics: Topic[]
  guests: string[]
  songs: Song[]
  highlights: Highlight[]
  editor_note: string
}

type Magazine = {
  id: string
  week_label: string
  week_start: string
  week_end: string
  issue_number: number | null
  content: MagazineContent
  cover_image_url: string | null
  stream_ids: string[] | null
}

type StreamInfo = { title: string; stream_date: string }

// -----------------------------------------------------------------------
// 定数
// -----------------------------------------------------------------------

const REASON_COLORS: Record<string, string> = {
  '笑い': 'bg-yellow-900/70 text-yellow-300',
  '名言': 'bg-blue-900/70 text-blue-300',
  '感動': 'bg-pink-900/70 text-pink-300',
  '驚き': 'bg-orange-900/70 text-orange-300',
  '神回': 'bg-purple-900/70 text-purple-300',
}

// -----------------------------------------------------------------------
// セクションヘッダー
// -----------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-0.5 h-4 bg-indigo-500 rounded-full flex-shrink-0" />
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{children}</h2>
    </div>
  )
}

// -----------------------------------------------------------------------
// 配信出所バッジ（共通）
// -----------------------------------------------------------------------

function StreamSourceBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-800/80 px-2 py-0.5 rounded-md max-w-full">
      <span className="text-gray-600 flex-shrink-0">配信</span>
      <span className="truncate">{title}</span>
    </span>
  )
}

// -----------------------------------------------------------------------
// ハイライトセクション
// -----------------------------------------------------------------------

function HighlightsSection({
  highlights,
  streamMap,
  entities,
}: {
  highlights: Highlight[]
  streamMap: Record<string, StreamInfo>
  entities: Entity[]
}) {
  /**
   * 配信タイトルでグルーピング。
   * streamMapが空（kusanagiのstream取得前）なら全件フラット表示にフォールバック。
   */
  const hasStreamInfo = Object.keys(streamMap).length > 0

  type Group = { videoId: string; streamTitle: string | null; items: Highlight[] }
  const groups: Group[] = []

  if (hasStreamInfo) {
    const seen = new Map<string, Group>()
    for (const h of highlights) {
      if (!seen.has(h.video_id)) {
        const g: Group = {
          videoId: h.video_id,
          streamTitle: streamMap[h.video_id]?.title ?? null,
          items: [],
        }
        seen.set(h.video_id, g)
        groups.push(g)
      }
      seen.get(h.video_id)!.items.push(h)
    }
  } else {
    groups.push({ videoId: '', streamTitle: null, items: highlights })
  }

  return (
    <section>
      <SectionHeading>今週の盛り上がり</SectionHeading>
      <div className="space-y-3">
        {groups.map((group, gi) => (
          <div key={gi} className="bg-gray-900 rounded-xl overflow-hidden">
            {/* 配信タイトルヘッダー */}
            {group.streamTitle && (
              <div className="px-4 py-2.5 bg-gray-800/50 border-b border-gray-800/80">
                <StreamSourceBadge title={group.streamTitle} />
              </div>
            )}

            <div className="divide-y divide-gray-800/60">
              {group.items.map((h, i) => {
                const linkSec = Math.max(0, (h.start_sec || 0) - 30)
                const url = `https://www.youtube.com/watch?v=${h.video_id}&t=${linkSec}`
                const mm = Math.floor((h.start_sec || 0) / 60)
                const ss = (h.start_sec || 0) % 60
                const timestamp = `${mm}:${String(ss).padStart(2, '0')}`

                return (
                  <div
                    key={i}
                    className="group px-4 py-3.5 hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* タイムスタンプ */}
                      <span className="text-xs text-gray-500 font-mono mt-0.5 flex-shrink-0 w-9 text-right">
                        {timestamp}
                      </span>

                      {/* 感情ラベル */}
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${REASON_COLORS[h.reason] ?? 'bg-gray-800/80 text-gray-400'}`}>
                        {h.reason}
                      </span>

                      {/* 発言内容 */}
                      <span className="text-sm text-gray-200 leading-relaxed flex-1">
                        「{linkifyEntities(h.quote, entities)}」
                      </span>

                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex-shrink-0 mt-0.5"
                      >
                        YouTube
                      </a>
                    </div>

                    {/* グルーピングなし時の出所表示（フォールバック） */}
                    {!hasStreamInfo && streamMap[h.video_id]?.title && (
                      <div className="mt-2 pl-12">
                        <StreamSourceBadge title={streamMap[h.video_id].title} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-700 mt-2 px-1">YouTubeリンクから該当シーンが開きます</p>
    </section>
  )
}

// -----------------------------------------------------------------------
// 楽曲セクション
// -----------------------------------------------------------------------

function SongsSection({
  songs,
  streamMap,
  entities,
}: {
  songs: Song[]
  streamMap: Record<string, StreamInfo>
  entities: Entity[]
}) {
  return (
    <section>
      <SectionHeading>今週流れた曲</SectionHeading>
      <div className="bg-gray-900 rounded-xl overflow-hidden divide-y divide-gray-800/60">
        {songs.map((s, i) => {
          const title = typeof s === 'string' ? s : s.title
          const videoId = typeof s === 'string' ? undefined : s.video_id
          const streamTitle = videoId ? streamMap[videoId]?.title : undefined
          const youtubeUrl = videoId
            ? `https://www.youtube.com/watch?v=${videoId}`
            : undefined

          const inner = (
            <div className="flex items-center gap-3 px-4 py-3">
              {/* 曲番号 */}
              <span className="text-xs text-gray-600 font-mono w-5 flex-shrink-0 text-right">
                {i + 1}
              </span>
              {/* 曲名 */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm text-gray-200 leading-snug">{linkifyEntities(title, entities)}</p>
                {streamTitle && (
                  <StreamSourceBadge title={streamTitle} />
                )}
              </div>
              {/* YouTubeリンクアイコン */}
              {youtubeUrl && (
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex-shrink-0"
                >
                  YouTube
                </a>
              )}
            </div>
          )

          return <div key={i} className="hover:bg-gray-800/50 transition-colors">{inner}</div>
        })}
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------
// メインページ
// -----------------------------------------------------------------------

export default function MagazineWeekPage() {
  const { week } = useParams<{ week: string }>()
  const [magazine, setMagazine] = useState<Magazine | null>(null)
  const [streamMap, setStreamMap] = useState<Record<string, StreamInfo>>({})
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data } = await supabase
        .from('magazines')
        .select('*')
        .eq('week_label', week)
        .single()

      if (cancelled) return

      if (data) {
        const mag = data as Magazine
        setMagazine(mag)

        const { data: entityRows } = await supabase
          .from('magazine_entities')
          .select('entity_id')
          .eq('magazine_id', mag.id)

        if (!cancelled && entityRows?.length) {
          const entityIds = (entityRows as unknown as { entity_id: string }[]).map((row) => row.entity_id)
          const { data: entityData } = await supabase
            .from('entities')
            .select('*')
            .in('id', entityIds)

          if (!cancelled && entityData) setEntities(entityData as Entity[])
        }

        // stream_ids から動画情報を取得して video_id ベースのマップを構築
        if (mag.stream_ids && mag.stream_ids.length > 0) {
          const { data: streams } = await supabase
            .from('streams')
            .select('video_id, title, stream_date')
            .in('id', mag.stream_ids)

          if (!cancelled && streams) {
            const map: Record<string, StreamInfo> = {}
            for (const s of streams as { video_id: string; title: string; stream_date: string }[]) {
              map[s.video_id] = { title: s.title, stream_date: s.stream_date }
            }
            setStreamMap(map)
          }
        }
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [week])

  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-gray-600">読み込み中</p>
      </div>
    </div>
  )

  if (!magazine) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-sm text-gray-400">マガジンが見つかりません</p>
        <Link href="/magazine" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          バックナンバーへ
        </Link>
      </div>
    </div>
  )

  const { content } = magazine
  const start = new Date(magazine.week_start).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const end = new Date(magazine.week_end).toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric',
  })

  return (
    <main className="min-h-screen bg-gray-950 text-white">

      {/* ヘッダーナビ（スクロールしても残る） */}
      <header className="border-b border-gray-800/80 px-4 py-4 flex items-center justify-between sticky top-0 bg-gray-950/90 backdrop-blur-sm z-10">
        <Link href="/magazine" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← バックナンバー
        </Link>
        <span className="text-xs text-gray-500">いっくん追いかけマガジン</span>
        <div className="w-24" />
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-10">

        {/* カバー画像 */}
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden">
          {magazine.cover_image_url ? (
            <img
              src={magazine.cover_image_url}
              alt={content.headline}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-gray-900 to-gray-950">
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 30% 40%, #6366f1 0%, transparent 60%), radial-gradient(circle at 70% 70%, #0ea5e9 0%, transparent 50%)',
                }}
              />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/20 to-transparent" />

          <div className="absolute top-3 left-3">
            <span className="bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs text-gray-300 font-medium">
              いっくん追いかけマガジン
            </span>
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-5">
            {magazine.issue_number != null && (
              <p className="text-xs text-indigo-300 font-mono font-semibold tracking-widest mb-1">
                No.{magazine.issue_number}
              </p>
            )}
            <p className="text-xs text-gray-400 mb-1.5">{start} 〜 {end}</p>
            <h1 className="text-xl font-bold leading-snug text-white">{content.headline}</h1>
          </div>
        </div>

        {/* イントロ */}
        <div className="border-l-2 border-gray-700 pl-4">
          <p className="text-sm text-gray-300 leading-relaxed">{linkifyEntities(content.intro, entities)}</p>
        </div>

        {/* トピック */}
        {content.topics?.length > 0 && (
          <section>
            <SectionHeading>今週のトピック</SectionHeading>
            <div className="space-y-3">
              {content.topics.map((topic, i) => (
                <div key={i} className="bg-gray-900 rounded-xl p-4 space-y-2">
                  <h3 className="text-sm font-bold text-white">{linkifyEntities(topic.title, entities)}</h3>
                  <p className="text-sm text-gray-300 leading-relaxed">{linkifyEntities(topic.body, entities)}</p>
                  {topic.streams?.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-gray-800/80 mt-2">
                      {topic.streams.map((s, j) => (
                        <Link
                          key={j}
                          href={`/stream/${s.video_id}${s.start_sec ? `#t=${s.start_sec}` : ''}`}
                          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          <span className="text-gray-600">配信</span>
                          <span className="truncate">{s.title}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 盛り上がり */}
        {content.highlights?.length > 0 && (
          <HighlightsSection highlights={content.highlights} streamMap={streamMap} entities={entities} />
        )}

        {/* ゲスト */}
        {content.guests?.length > 0 && (
          <section>
            <SectionHeading>今週のゲスト</SectionHeading>
            <div className="flex flex-wrap gap-2">
              {content.guests.map((g, i) => (
                <span
                  key={i}
                  className="text-sm text-emerald-300 bg-emerald-900/30 border border-emerald-800/50 px-3 py-1 rounded-full"
                >
                  {linkifyEntities(g, entities)}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* 楽曲 */}
        {content.songs?.length > 0 && (
          <SongsSection songs={content.songs} streamMap={streamMap} entities={entities} />
        )}

        {/* 編集後記 */}
        {content.editor_note && (
          <section className="border-t border-gray-800/80 pt-8">
            <p className="text-xs text-gray-600 mb-2 uppercase tracking-widest">編集後記</p>
            <p className="text-sm text-gray-400 leading-relaxed">{linkifyEntities(content.editor_note, entities)}</p>
          </section>
        )}

        {/* フッターナビ */}
        <div className="pt-2 pb-8">
          <Link href="/magazine" className="text-sm text-gray-500 hover:text-white transition-colors">
            ← バックナンバー一覧
          </Link>
        </div>
      </div>
    </main>
  )
}
