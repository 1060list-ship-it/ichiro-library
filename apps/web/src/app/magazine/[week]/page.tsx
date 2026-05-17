'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

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

type MagazineContent = {
  headline: string
  intro: string
  topics: Topic[]
  guests: string[]
  songs: string[]
  highlights: Highlight[]
  editor_note: string
}

type Magazine = {
  id: string
  week_label: string
  week_start: string
  week_end: string
  content: MagazineContent
  cover_image_url: string | null
}

const REASON_COLORS: Record<string, string> = {
  '笑い': 'bg-yellow-900 text-yellow-300',
  '名言': 'bg-blue-900 text-blue-300',
  '感動': 'bg-pink-900 text-pink-300',
  '驚き': 'bg-orange-900 text-orange-300',
  '神回': 'bg-purple-900 text-purple-300',
}

export default function MagazineWeekPage() {
  const { week } = useParams<{ week: string }>()
  const [magazine, setMagazine] = useState<Magazine | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('magazines')
      .select('*')
      .eq('week_label', week)
      .single()
      .then(({ data }) => {
        if (data) setMagazine(data as Magazine)
        setLoading(false)
      })
  }, [week])

  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">読み込み中...</div>
  )
  if (!magazine) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">マガジンが見つかりません</div>
  )

  const { content } = magazine
  const start = new Date(magazine.week_start).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  const end = new Date(magazine.week_end).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <Link href="/magazine" className="text-gray-400 hover:text-white text-sm">← バックナンバー</Link>
        <span className="text-xs text-gray-500">いっくん追いかけマガジン</span>
        <div className="w-24" />
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">

        {/* カバー画像 */}
        {magazine.cover_image_url ? (
          <div className="relative w-full aspect-square rounded-xl overflow-hidden">
            <img
              src={magazine.cover_image_url}
              alt={content.headline}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4">
              <p className="text-xs text-gray-400 mb-1">{start} 〜 {end}</p>
              <h1 className="text-lg font-bold leading-snug text-white drop-shadow">{content.headline}</h1>
            </div>
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-xs text-gray-300 font-medium">
              いっくん追いかけマガジン
            </div>
          </div>
        ) : (
          <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-indigo-950 via-gray-900 to-gray-950 flex items-end">
            <div className="absolute inset-0 opacity-20"
              style={{ backgroundImage: 'radial-gradient(circle at 30% 40%, #6366f1 0%, transparent 60%), radial-gradient(circle at 70% 70%, #0ea5e9 0%, transparent 50%)' }} />
            <div className="relative p-4 w-full">
              <p className="text-xs text-gray-400 mb-1">{start} 〜 {end}</p>
              <h1 className="text-lg font-bold leading-snug text-white">{content.headline}</h1>
            </div>
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-xs text-gray-300 font-medium">
              いっくん追いかけマガジン
            </div>
          </div>
        )}

        {/* イントロ */}
        <div>
          <p className="text-sm text-gray-300 leading-relaxed">{content.intro}</p>
        </div>

        {/* トピック */}
        {content.topics?.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xs text-gray-500 font-medium uppercase tracking-wider">今週のトピック</h2>
            {content.topics.map((topic, i) => (
              <div key={i} className="bg-gray-900 rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-bold text-white">{topic.title}</h3>
                <p className="text-sm text-gray-300 leading-relaxed">{topic.body}</p>
                {topic.streams?.length > 0 && (
                  <div className="flex flex-col gap-1 pt-1">
                    {topic.streams.map((s, j) => (
                      <Link key={j}
                        href={`/stream/${s.video_id}${s.start_sec ? `#t=${s.start_sec}` : ''}`}
                        className="text-xs text-indigo-400 hover:text-indigo-300 truncate">
                        → {s.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* 盛り上がり */}
        {content.highlights?.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs text-gray-500 font-medium uppercase tracking-wider">今週の盛り上がり</h2>
            <div className="bg-gray-900 rounded-lg overflow-hidden divide-y divide-gray-800">
              {content.highlights.map((h, i) => {
                const linkSec = Math.max(0, (h.start_sec || 0) - 30)
                const url = `https://www.youtube.com/watch?v=${h.video_id}&t=${linkSec}`
                const mm = Math.floor((h.start_sec || 0) / 60)
                const ss = (h.start_sec || 0) % 60
                const timestamp = `${mm}:${String(ss).padStart(2, '0')}`
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-3 px-4 py-3 hover:bg-gray-800 transition-colors">
                    <span className="text-xs text-gray-400 font-mono mt-0.5 flex-shrink-0">{timestamp}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${REASON_COLORS[h.reason] ?? 'bg-gray-800 text-gray-300'}`}>
                      {h.reason}
                    </span>
                    <span className="text-sm text-gray-200 leading-snug">「{h.quote}」</span>
                  </a>
                )
              })}
            </div>
          </section>
        )}

        {/* ゲスト */}
        {content.guests?.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs text-gray-500 font-medium uppercase tracking-wider">今週のゲスト</h2>
            <div className="flex flex-wrap gap-2">
              {content.guests.map((g, i) => (
                <span key={i} className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full">{g}</span>
              ))}
            </div>
          </section>
        )}

        {/* 楽曲 */}
        {content.songs?.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs text-gray-500 font-medium uppercase tracking-wider">今週流れた曲</h2>
            <div className="flex flex-wrap gap-2">
              {content.songs.map((s, i) => (
                <span key={i} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          </section>
        )}

        {/* 編集後記 */}
        {content.editor_note && (
          <section className="border-t border-gray-800 pt-6">
            <p className="text-xs text-gray-500 mb-1">編集後記</p>
            <p className="text-sm text-gray-400 italic leading-relaxed">{content.editor_note}</p>
          </section>
        )}

        {/* 一覧に戻る */}
        <div className="pt-2">
          <Link href="/magazine" className="text-sm text-gray-500 hover:text-white">← バックナンバー一覧</Link>
        </div>
      </div>
    </main>
  )
}
