'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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

export default function MagazinePage() {
  const [magazines, setMagazines] = useState<Magazine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('magazines')
      .select('id, week_label, week_start, week_end, content, generated_at')
      .order('week_label', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setMagazines(data as Magazine[])
        setLoading(false)
      })
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

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {magazines.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-12">まだマガジンがありません</p>
        ) : (
          magazines.map(mag => {
            const start = new Date(mag.week_start).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })
            const end = new Date(mag.week_end).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })
            return (
              <Link key={mag.id} href={`/magazine/${mag.week_label}`}
                className="block bg-gray-900 rounded-lg overflow-hidden hover:bg-gray-800 transition-colors">
                {mag.cover_image_url ? (
                  <div className="relative w-full h-40 overflow-hidden">
                    <img src={mag.cover_image_url} alt={mag.content.headline}
                      className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 to-transparent" />
                    <p className="absolute bottom-2 left-4 text-xs text-gray-400">{start} 〜 {end}</p>
                  </div>
                ) : (
                  <div className="w-full h-24 bg-gradient-to-br from-indigo-950 to-gray-900" />
                )}
                <div className="p-4">
                  <h2 className="text-base font-bold text-white mb-1">{mag.content.headline}</h2>
                  <p className="text-sm text-gray-300 leading-relaxed line-clamp-2">{mag.content.intro}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {mag.content.topics.slice(0, 4).map((t, i) => (
                      <span key={i} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                        {t.title}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </main>
  )
}
