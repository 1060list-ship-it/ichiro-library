'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Stream } from '@/lib/types'
import StreamCard from '@/components/StreamCard'
import SearchBar from '@/components/SearchBar'

const CATEGORIES = [
  { key: 'ranking-view',   label: '再生数' },
  { key: 'ranking-god',    label: '支持率' },
  { key: 'ライブビデオ解説', label: 'ライブビデオ解説' },
  { key: '深夜対談',        label: '深夜対談' },
  { key: '未知との遭遇',    label: '未知との遭遇' },
  { key: 'ゲーム実況',      label: 'ゲーム実況' },
  { key: '歌唱あり',        label: '歌唱あり' },
]

type View = 'top' | string

export default function Home() {
  const [view, setView] = useState<View>('top')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [streams, setStreams] = useState<Stream[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    fetchStreams()
  }, [view, debouncedQuery])

  async function fetchStreams() {
    setLoading(true)
    let data: Stream[] = []

    if (debouncedQuery.trim()) {
      const res = await supabase
        .from('streams').select('*')
        .or(`title.ilike.%${debouncedQuery}%,summary.ilike.%${debouncedQuery}%`)
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === 'top') {
      const res = await supabase.from('streams').select('*')
        .order('stream_date', { ascending: false }).limit(10)
      data = res.data ?? []
    } else if (view === 'ranking-view') {
      const res = await supabase.from('streams').select('*')
        .order('view_count', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === 'ranking-god') {
      const res = await supabase.from('streams').select('*')
        .not('like_count', 'is', null).not('view_count', 'is', null)
        .order('like_count', { ascending: false }).limit(20)
      const godData = (res.data ?? []) as Stream[]
      data = godData.sort((a, b) =>
        (b.like_count! / (b.view_count || 1)) - (a.like_count! / (a.view_count || 1))
      )
    } else if (view === '歌唱あり') {
      const res = await supabase.from('streams').select('*')
        .eq('has_live_singing', true)
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === 'ゲーム実況') {
      const res = await supabase.from('streams').select('*')
        .ilike('title', '%ゲーム中%')
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === '未知との遭遇') {
      const res = await supabase.from('streams').select('*')
        .contains('corner_names', ['未知との遭遇'])
        .not('title', 'ilike', '%ゲーム中%')
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else {
      const res = await supabase.from('streams').select('*')
        .contains('corner_names', [view])
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    }

    setStreams(data)
    setLoading(false)
  }

  const isSearching = debouncedQuery.trim().length > 0
  const currentLabel = CATEGORIES.find(c => c.key === view)?.label
  const showRank = view === 'ranking-view' || view === 'ranking-god'

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4 text-center">
        <h1
          className="text-xl font-bold tracking-wide cursor-pointer hover:text-gray-300 inline-block"
          onClick={() => { setView('top'); setQuery('') }}
        >
          ichiro library
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">山口一郎 YouTubeライブ アーカイブ</p>
      </header>

      {/* カテゴリナビゲーション */}
      <nav className="border-b border-gray-800 px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide justify-center">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => { setView(cat.key); setQuery('') }}
            className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full transition-colors ${
              view === cat.key && !isSearching
                ? 'bg-white text-gray-950 font-semibold'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <SearchBar value={query} onChange={setQuery} />

        {/* セクションタイトル */}
        <div className="flex items-center gap-3">
          {view !== 'top' && !isSearching && (
            <button
              onClick={() => setView('top')}
              className="text-xs text-gray-400 hover:text-white"
            >
              ← TOP
            </button>
          )}
          <h2 className="text-sm font-semibold text-gray-300">
            {isSearching ? `「${debouncedQuery}」の検索結果` : view === 'top' ? '最近の配信' : currentLabel}
          </h2>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-12">読み込み中...</p>
        ) : streams.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">
            {isSearching ? '該当する配信が見つかりません' : '該当する配信がまだありません'}
          </p>
        ) : (
          <div className="space-y-3">
            {streams.map((s, i) => (
              <StreamCard key={s.id} stream={s} rank={showRank ? i + 1 : undefined} />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-gray-800 mt-12 px-4 py-6 text-center text-xs text-gray-500">
        <p>管理者: <a href="https://x.com/ikki_i" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 underline">ikki</a></p>
        <p className="mt-1">非公式ファンサイト。サカナクション・山口一郎とは無関係です。</p>
      </footer>
    </main>
  )
}
