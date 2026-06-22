'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Stream } from '@/lib/types'
import StreamCard from '@/components/StreamCard'
import SearchBar from '@/components/SearchBar'

const CATEGORIES = [
  { key: 'ranking-view',   label: '再生数',        description: '再生数が多い配信ランキング' },
  { key: 'ranking-waiwai', label: 'ワイワイ',       description: 'コメント数＝盛り上がり度が高かった配信ランキング' },
  { key: 'ライブビデオ解説', label: 'ライブビデオ解説', description: 'MVやライブ映像を一郎がリアルタイムで解説するコーナー' },
  { key: '深夜対談',        label: '深夜対談',       description: '深夜に仲間と本音で語り合うトークコーナー' },
  { key: '未知との遭遇',    label: '未知との遭遇',   description: '一郎が知らないアーティストや楽曲に初めて触れるコーナー' },
  { key: 'ゲーム実況',      label: 'ゲーム実況',     description: '一郎がゲームをプレイ・実況する配信' },
  { key: '歌唱あり',        label: '歌唱あり',       description: 'ライブ中に歌唱シーンがある配信' },
]

type View = 'top' | string

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [view, setView] = useState<View>(() => searchParams.get('view') ?? 'top')
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchParams.get('q') ?? '')
  const [fuzzy, setFuzzy] = useState(() => searchParams.get('fuzzy') === '1')
  const [year, setYear] = useState<number | null>(() => {
    const y = searchParams.get('year')
    return y ? parseInt(y, 10) : null
  })
  const [availableYears, setAvailableYears] = useState<number[]>([])
  const [streams, setStreams] = useState<Stream[]>([])
  const [loading, setLoading] = useState(true)

  // 利用可能な年一覧をDBから取得
  useEffect(() => {
    supabase.from('streams').select('stream_date').not('stream_date', 'is', null)
      .then(({ data }) => {
        if (!data) return
        const years = [...new Set((data as { stream_date: string }[]).map(r => new Date(r.stream_date).getFullYear()))]
          .sort((a, b) => b - a)
        setAvailableYears(years)
      })
  }, [])

  // URLクエリパラメータに状態を同期（ブラウザバックで検索を復元するため）
  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (view !== 'top') params.set('view', view)
    if (fuzzy) params.set('fuzzy', '1')
    if (year !== null) params.set('year', String(year))
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '/', { scroll: false })
  }, [query, view, fuzzy, year, router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400)
    return () => clearTimeout(t)
  }, [query])

  const fetchStreams = useCallback(async () => {
    setLoading(true)
    let data: Stream[] = []

    const yearFrom = year !== null ? `${year}-01-01` : null
    const yearTo   = year !== null ? `${year + 1}-01-01` : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yd = (q: any) => yearFrom ? q.gte('stream_date', yearFrom).lt('stream_date', yearTo) : q

    if (debouncedQuery.trim()) {
      const parts = debouncedQuery.trim().split(/\s+/).filter(Boolean)
      const includes = parts.filter(k => !k.startsWith('-'))
      const excludes = parts.filter(k => k.startsWith('-')).map(k => k.slice(1)).filter(Boolean)

      if (fuzzy) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).rpc('search_streams', {
          query: includes.join(' ') || debouncedQuery,
          sort_by: 'date_desc',
          page_num: 1,
          page_size: 50,
        })
        let results = (res.data ?? []) as Stream[]
        if (yearFrom) {
          results = results.filter(s =>
            s.stream_date >= yearFrom && s.stream_date < yearTo!
          )
        }
        data = excludes.length > 0
          ? results.filter(s => excludes.every(ex =>
              !s.title?.toLowerCase().includes(ex.toLowerCase()) &&
              !s.summary?.toLowerCase().includes(ex.toLowerCase())
            ))
          : results
      } else {
        // テキストOR検索（includeキーワード）
        let textStreams: Stream[] = []
        if (includes.length > 0) {
          const textConds = includes.flatMap(kw =>
            [`title.ilike.%${kw}%`, `summary.ilike.%${kw}%`]
          ).join(',')
          let q = yd(supabase.from('streams').select('*').or(textConds))
          for (const ex of excludes) {
            q = q.not('title', 'ilike', `%${ex}%`).not('summary', 'ilike', `%${ex}%`)
          }
          const textRes = await q.order('stream_date', { ascending: false }).limit(20)
          textStreams = (textRes.data ?? []) as Stream[]
        }

        // エンティティ名・match_namesから関連配信を検索（includeのみ使用）
        const entityIds = new Set<string>()
        await Promise.all(includes.map(async kw => {
          const [byName, byAlias] = await Promise.all([
            supabase.from('entities').select('id').ilike('name', `%${kw}%`),
            supabase.from('entities').select('id').contains('match_names', [kw]),
          ])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(byName.data ?? []).forEach((e: any) => entityIds.add(e.id))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(byAlias.data ?? []).forEach((e: any) => entityIds.add(e.id))
        }))

        let entityStreams: Stream[] = []
        if (entityIds.size > 0) {
          const seRes = await supabase.from('stream_entities')
            .select('stream_id')
            .in('entity_id', [...entityIds])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const streamIds = (seRes.data ?? []).map((r: any) => r.stream_id)
          if (streamIds.length > 0) {
            let q = yd(supabase.from('streams').select('*').in('id', streamIds))
            for (const ex of excludes) {
              q = q.not('title', 'ilike', `%${ex}%`).not('summary', 'ilike', `%${ex}%`)
            }
            const sRes = await q.order('stream_date', { ascending: false }).limit(20)
            entityStreams = (sRes.data ?? []) as Stream[]
          }
        }

        // マージ・重複除去
        const seen = new Set<string>()
        data = [...textStreams, ...entityStreams].filter(s => {
          if (seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })
      }
    } else if (view === 'top') {
      const res = await yd(supabase.from('streams').select('*'))
        .order('stream_date', { ascending: false }).limit(year ? 20 : 10)
      data = res.data ?? []
    } else if (view === 'ranking-view') {
      const res = await yd(supabase.from('streams').select('*'))
        .order('view_count', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === 'ranking-waiwai') {
      const res = await yd(supabase.from('streams').select('*'))
        .not('comment_count', 'is', null)
        .order('comment_count', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === '歌唱あり') {
      const res = await yd(supabase.from('streams').select('*'))
        .eq('has_live_singing', true)
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === 'ゲーム実況') {
      const res = await yd(supabase.from('streams').select('*'))
        .ilike('title', '%ゲーム中%')
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else if (view === '未知との遭遇') {
      const res = await yd(supabase.from('streams').select('*'))
        .contains('corner_names', ['未知との遭遇'])
        .not('title', 'ilike', '%ゲーム中%')
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    } else {
      const res = await yd(supabase.from('streams').select('*'))
        .contains('corner_names', [view])
        .order('stream_date', { ascending: false }).limit(20)
      data = res.data ?? []
    }

    setStreams(data)
    setLoading(false)
  }, [view, debouncedQuery, fuzzy, year])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStreams()
  }, [fetchStreams])

  const [showHelp, setShowHelp] = useState(false)

  const isSearching = debouncedQuery.trim().length > 0
  const currentCategory = CATEGORIES.find(c => c.key === view)
  const currentLabel = currentCategory?.label
  const currentDescription = currentCategory?.description
  const showRank = view === 'ranking-view' || view === 'ranking-waiwai'

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4 text-center relative">
        <h1
          className="text-xl font-bold tracking-wide cursor-pointer hover:text-gray-300 inline-block"
          onClick={() => { setView('top'); setQuery('') }}
        >
          ichiro library
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">山口一郎 YouTubeライブ アーカイブ</p>
        <Link href="/magazine"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-indigo-400 hover:text-indigo-300 font-medium">
          マガジン →
        </Link>
      </header>

      {/* カテゴリナビゲーション */}
      <nav className="border-b border-gray-800 px-4 py-2 flex flex-wrap gap-2 justify-center">
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
        <SearchBar value={query} onChange={setQuery} fuzzy={fuzzy} onFuzzyChange={setFuzzy} />

        {/* 年フィルター */}
        {availableYears.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 flex-shrink-0">期間：</span>
            <button
              onClick={() => setYear(null)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                year === null
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              全期間
            </button>
            {availableYears.map(y => (
              <button
                key={y}
                onClick={() => setYear(year === y ? null : y)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  year === y
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {y}年
              </button>
            ))}
          </div>
        )}

        {/* 検索ガイド */}
        <div>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <span>{showHelp ? '▾' : '▸'}</span>
            <span>検索の使い方</span>
          </button>
          {showHelp && (
            <div className="mt-2 rounded-lg bg-gray-900 border border-gray-800 p-4 text-xs text-gray-400 space-y-3">
              <div className="space-y-1.5">
                <p className="text-gray-300 font-semibold">キーワード検索</p>
                <p>入力したキーワードをタイトル・要約から検索します。</p>
                <p>スペース区切りで複数入力すると <span className="text-white font-mono">OR</span> 検索になります。</p>
                <div className="font-mono text-gray-500 space-y-0.5">
                  <p><span className="text-gray-300">浜田 ハマダ</span> → どちらかにヒットするものを表示</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-gray-300 font-semibold">除外検索</p>
                <p><span className="text-white font-mono">-</span> を先頭につけたキーワードを含む配信を除外します。</p>
                <div className="font-mono text-gray-500 space-y-0.5">
                  <p><span className="text-gray-300">浜田 -ゲーム</span> → 浜田を含み、ゲームを含まない</p>
                  <p><span className="text-gray-300">-深夜 -歌</span> → 深夜と歌を両方除外</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-gray-300 font-semibold">あいまい検索</p>
                <p>検索欄右のトグルをオンにすると、表記ゆれや関連語もまとめてヒットします。</p>
                <p className="text-gray-500">例：「さかな」で「サカナクション」もヒット</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-gray-300 font-semibold">人物・エンティティ検索</p>
                <p>登録済みの人物名や別名（表記ゆれ）でも検索できます。テキストに名前が出ていない配信でも、エンティティとして紐付けられていれば表示されます。</p>
                <p className="mt-1">
                  <Link href="/entity" className="text-indigo-400 hover:text-indigo-300 underline">
                    人物索引を見る →
                  </Link>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* セクションタイトル */}
        <div className="flex items-start gap-3">
          {view !== 'top' && !isSearching && (
            <button
              onClick={() => setView('top')}
              className="text-xs text-gray-400 hover:text-white mt-0.5 flex-shrink-0"
            >
              ← TOP
            </button>
          )}
          <div>
            <h2 className="text-sm font-semibold text-gray-300">
              {isSearching
                ? `「${debouncedQuery}」の検索結果${year ? ` (${year}年)` : ''}`
                : view === 'top'
                  ? year ? `${year}年の配信` : '最近の配信'
                  : `${currentLabel}${year ? ` (${year}年)` : ''}`}
            </h2>
            {!isSearching && view !== 'top' && currentDescription && (
              <p className="text-xs text-gray-500 mt-0.5">{currentDescription}</p>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-12">読み込み中...</p>
        ) : streams.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">
            {isSearching ? '該当する配信が見つかりません' : '該当する配信がまだありません'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {streams.map((s, i) => (
              <StreamCard key={s.id} stream={s} rank={showRank ? i + 1 : undefined} />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-gray-800 mt-12 px-4 py-6 text-center text-xs text-gray-500">
        <p>管理者: <a href="https://x.com/ikki_i" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 underline">ikki</a></p>
        <p className="mt-1">非公式ファンサイト。サカナクション・山口一郎とは無関係です。</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/about" className="hover:text-gray-300 underline">このサービスについて</Link>
          <Link href="/privacy" className="hover:text-gray-300 underline">プライバシーポリシー</Link>
        </p>
      </footer>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <HomeContent />
    </Suspense>
  )
}
