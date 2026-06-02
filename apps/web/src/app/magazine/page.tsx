'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getMagazineCoverUrl } from '@/lib/magazineCovers'
import { supabase } from '@/lib/supabase'

type Magazine = {
  id: string
  week_label: string
  week_start: string
  week_end: string
  content: {
    headline: string
    intro: string
    topics: { title: string }[]
    guests: string[]
    songs: string[]
    highlights: unknown[]
  }
  cover_image_url: string | null
  generated_at: string
}

const LOAD_TIMEOUT_MS = 10000

function withTimeout<T>(promise: PromiseLike<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), LOAD_TIMEOUT_MS)
    }),
  ])
}

function formatMagazineNumber(weekLabel: string) {
  return weekLabel.replaceAll('-', '')
}

export default function MagazinePage() {
  const [magazines, setMagazines] = useState<Magazine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const { data, error: queryError } = await withTimeout(
          supabase
            .from('magazines')
            .select('id, week_label, week_start, week_end, content, cover_image_url, generated_at')
            .order('week_label', { ascending: false })
            .limit(20),
          'マガジン一覧の取得がタイムアウトしました'
        )

        if (cancelled) return

        if (queryError) {
          setError(queryError.message)
          return
        }

        setMagazines((data ?? []) as Magazine[])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'マガジン一覧の取得に失敗しました')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">読み込み中...</div>
  )

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-gray-400 hover:text-white text-sm">← 配信一覧</Link>
        <h1 className="text-sm font-bold text-white">いっくん追いかけマガジン</h1>
        <div className="w-16" />
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {magazines.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            {error ? (
              <>
                <p className="text-red-300 text-sm">マガジンを読み込めませんでした</p>
                <p className="text-gray-600 text-xs">{error}</p>
              </>
            ) : (
              <p className="text-gray-500 text-sm">まだマガジンがありません</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {magazines.map(mag => {
              const start = new Date(mag.week_start).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
              const end = new Date(mag.week_end).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
              const magazineNumber = formatMagazineNumber(mag.week_label)
              const coverImageUrl = getMagazineCoverUrl(mag.week_label, mag.cover_image_url)
              return (
                <Link key={mag.id} href={`/magazine/${mag.week_label}`}
                  className="group flex gap-4 py-4 hover:bg-gray-900 transition-colors -mx-2 px-2 rounded-lg">
                  <div className="flex-shrink-0 w-20 aspect-[210/297] rounded-sm overflow-hidden bg-neutral-100 shadow-lg shadow-black/30 ring-1 ring-white/10">
                    {coverImageUrl ? (
                      <img src={coverImageUrl} alt={mag.content.headline}
                        className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full bg-neutral-100 text-gray-950 px-2 py-2 flex flex-col justify-between">
                        <span className="text-[10px] font-black tracking-[0.2em] leading-tight">ICHIRO<br />LIBRARY</span>
                        <span className="text-[10px] font-mono font-bold">{magazineNumber}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 py-1">
                    <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1.5">
                      <span className="text-indigo-400 font-mono font-semibold">{magazineNumber}</span>
                      <span>{start}〜{end}</span>
                    </p>
                    <p className="text-base font-bold text-white leading-snug line-clamp-2 mb-2 group-hover:text-indigo-100 transition-colors">
                      {mag.content.headline}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {mag.content.topics.slice(0, 3).map((t, i) => (
                        <span key={i} className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                          {t.title}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
