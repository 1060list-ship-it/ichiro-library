'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PUBLIC_STREAM_CARD_SELECT } from '@/lib/selects'
import type { Stream } from '@/lib/types'
import StreamCard from '@/components/StreamCard'
import SearchBar from '@/components/SearchBar'

const CATEGORIES = [
  { key: 'top',          label: '最新' },
  { key: 'ranking-view', label: '再生数' },
]

type View = 'top' | string
type ActiveCardFilter = { kind: 'tag' | 'corner'; value: string }
type HomeStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'duration_min' | 'view_count' | 'comment_count' | 'summary' | 'tags' | 'corner_names' | 'thumbnail_url'>

function matchesCardFilter(stream: Pick<Stream, 'tags' | 'corner_names'>, filter: ActiveCardFilter | null) {
  if (!filter) return true
  if (filter.kind === 'tag') return (stream.tags ?? []).includes(filter.value)
  return (stream.corner_names ?? []).includes(filter.value)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCardFilter(query: any, filter: ActiveCardFilter | null) {
  if (!filter) return query
  if (filter.kind === 'tag') return query.contains('tags', [filter.value])
  return query.contains('corner_names', [filter.value])
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseJapaneseDateFromQuery(q: string): {
  year: number | null
  month: number | null
  remaining: string
  label: string | null
} {
  const ymMatch = q.match(/(\d{4})年(\d{1,2})月/)
  if (ymMatch) {
    return {
      year: parseInt(ymMatch[1], 10),
      month: parseInt(ymMatch[2], 10),
      remaining: q.replace(ymMatch[0], '').trim(),
      label: `${ymMatch[1]}年${ymMatch[2]}月`,
    }
  }
  const yMatch = q.match(/(\d{4})年/)
  if (yMatch) {
    return {
      year: parseInt(yMatch[1], 10),
      month: null,
      remaining: q.replace(yMatch[0], '').trim(),
      label: `${yMatch[1]}年`,
    }
  }
  return { year: null, month: null, remaining: q, label: null }
}

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
  const [activeFilter, setActiveFilter] = useState<ActiveCardFilter | null>(() => {
    const tag = searchParams.get('tag')
    if (tag) return { kind: 'tag', value: tag }
    const corner = searchParams.get('corner')
    return corner ? { kind: 'corner', value: corner } : null
  })
  const [availableYears, setAvailableYears] = useState<number[]>([])
  const [streams, setStreams] = useState<HomeStream[]>([])
  const [resultCount, setResultCount] = useState<number>(0)
  const [latestUpdatedAt, setLatestUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 利用可能な年一覧と最終更新日時を取得
  useEffect(() => {
    Promise.all([
      supabase.from('streams').select('stream_date').not('stream_date', 'is', null),
      supabase.from('streams').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([yearRes, updatedRes]) => {
      if (yearRes.data) {
        const years = [...new Set((yearRes.data as { stream_date: string }[]).map(r => new Date(r.stream_date).getFullYear()))]
          .sort((a, b) => b - a)
        setAvailableYears(years)
      }

      const latestStream = updatedRes.data as Pick<Stream, 'updated_at'> | null
      if (latestStream?.updated_at) {
        setLatestUpdatedAt(latestStream.updated_at)
      }
    })
  }, [])

  // URLクエリパラメータに状態を同期（ブラウザバックで検索を復元するため）
  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (view !== 'top') params.set('view', view)
    if (fuzzy) params.set('fuzzy', '1')
    if (year !== null) params.set('year', String(year))
    if (activeFilter?.kind === 'tag') params.set('tag', activeFilter.value)
    if (activeFilter?.kind === 'corner') params.set('corner', activeFilter.value)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '/', { scroll: false })
  }, [query, view, fuzzy, year, activeFilter, router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400)
    return () => clearTimeout(t)
  }, [query])

  const fetchStreams = useCallback(async () => {
    setLoading(true)
    let data: HomeStream[] = []
    let count = 0

    const parsed = parseJapaneseDateFromQuery(debouncedQuery.trim())
    const textQuery = parsed.remaining
    const effectiveYear = parsed.year ?? year
    const effectiveMonth = parsed.month
    let dateFrom: string | null = null
    let dateTo: string | null = null
    if (effectiveYear !== null && effectiveMonth !== null) {
      dateFrom = `${effectiveYear}-${String(effectiveMonth).padStart(2, '0')}-01`
      const nm = effectiveMonth === 12 ? 1 : effectiveMonth + 1
      const ny = effectiveMonth === 12 ? effectiveYear + 1 : effectiveYear
      dateTo = `${ny}-${String(nm).padStart(2, '0')}-01`
    } else if (effectiveYear !== null) {
      dateFrom = `${effectiveYear}-01-01`
      dateTo = `${effectiveYear + 1}-01-01`
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yd = (q: any) => dateFrom ? q.gte('stream_date', dateFrom).lt('stream_date', dateTo) : q

    if (debouncedQuery.trim() && textQuery.trim()) {
      const parts = textQuery.trim().split(/\s+/).filter(Boolean)
      const includes = parts.filter(k => !k.startsWith('-'))
      const excludes = parts.filter(k => k.startsWith('-')).map(k => k.slice(1)).filter(Boolean)

      if (fuzzy) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).rpc('search_streams', {
          query: includes.join(' ') || textQuery,
          sort_by: 'date_desc',
          page_num: 1,
          page_size: 500,
        })
        let results = (res.data ?? []) as HomeStream[]
        if (dateFrom) {
          results = results.filter(s =>
            s.stream_date >= dateFrom! && s.stream_date < dateTo!
          )
        }
        results = results.filter((stream) => matchesCardFilter(stream, activeFilter))
        const filtered = excludes.length > 0
          ? results.filter(s => excludes.every(ex =>
              !s.title?.toLowerCase().includes(ex.toLowerCase()) &&
              !s.summary?.toLowerCase().includes(ex.toLowerCase())
            ))
          : results
        count = filtered.length
        data = filtered.slice(0, 50)
      } else {
        // テキストOR検索（includeキーワード）
        let textStreams: HomeStream[] = []
        if (includes.length > 0) {
          const textConds = includes.flatMap(kw =>
            [`title.ilike.%${kw}%`, `summary.ilike.%${kw}%`]
          ).join(',')
          let q = applyCardFilter(yd(supabase.from('streams').select(PUBLIC_STREAM_CARD_SELECT).or(textConds)), activeFilter)
          for (const ex of excludes) {
            q = q.not('title', 'ilike', `%${ex}%`).not('summary', 'ilike', `%${ex}%`)
          }
          const textRes = await q.order('stream_date', { ascending: false })
          textStreams = (textRes.data ?? []) as HomeStream[]
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

        let entityStreams: HomeStream[] = []
        if (entityIds.size > 0) {
          const seRes = await supabase.from('stream_entities')
            .select('stream_id')
            .in('entity_id', [...entityIds])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const streamIds = (seRes.data ?? []).map((r: any) => r.stream_id)
          if (streamIds.length > 0) {
            let q = applyCardFilter(yd(supabase.from('streams').select(PUBLIC_STREAM_CARD_SELECT).in('id', streamIds)), activeFilter)
            for (const ex of excludes) {
              q = q.not('title', 'ilike', `%${ex}%`).not('summary', 'ilike', `%${ex}%`)
            }
            const sRes = await q.order('stream_date', { ascending: false })
            entityStreams = (sRes.data ?? []) as HomeStream[]
          }
        }

        // マージ・重複除去
        const seen = new Set<string>()
        const merged = [...textStreams, ...entityStreams].filter(s => {
          if (seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })
        merged.sort((a, b) => new Date(b.stream_date).getTime() - new Date(a.stream_date).getTime())
        count = merged.length
        data = merged.slice(0, 20)
      }
    } else if (debouncedQuery.trim()) {
      // 日付のみのクエリ（キーワードなし）— 該当月の配信一覧
      const countRes = await applyCardFilter(yd(supabase.from('streams').select('id', { count: 'exact', head: true })), activeFilter)
      count = countRes.count ?? 0
      const res = await applyCardFilter(yd(supabase.from('streams').select(PUBLIC_STREAM_CARD_SELECT)), activeFilter)
        .order('stream_date', { ascending: false }).limit(50)
      data = (res.data ?? []) as HomeStream[]
    } else if (view === 'top') {
      const countRes = await applyCardFilter(yd(supabase.from('streams').select('id', { count: 'exact', head: true })), activeFilter)
      count = countRes.count ?? 0
      const res = await applyCardFilter(yd(supabase.from('streams').select(PUBLIC_STREAM_CARD_SELECT)), activeFilter)
        .order('stream_date', { ascending: false }).limit(year ? 20 : 10)
      data = res.data ?? []
    } else if (view === 'ranking-view') {
      const countRes = await applyCardFilter(yd(supabase.from('streams').select('id', { count: 'exact', head: true })), activeFilter)
      count = countRes.count ?? 0
      const res = await applyCardFilter(yd(supabase.from('streams').select(PUBLIC_STREAM_CARD_SELECT)), activeFilter)
        .order('view_count', { ascending: false }).limit(20)
      data = res.data ?? []
    }

    setStreams(data)
    setResultCount(count)
    setLoading(false)
  }, [view, debouncedQuery, fuzzy, year, activeFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStreams()
  }, [fetchStreams])

  const [showHelp, setShowHelp] = useState(false)

  const isSearching = debouncedQuery.trim().length > 0
  const parsedDisplay = parseJapaneseDateFromQuery(debouncedQuery.trim())
  const textQueryDisplay = parsedDisplay.remaining.trim()
  const currentCategory = CATEGORIES.find(c => c.key === view)
  const currentLabel = currentCategory?.label
  const showRank = view === 'ranking-view'
  const activeFilterLabel = activeFilter
    ? `${activeFilter.kind === 'tag' ? 'タグ' : 'コーナー'}: ${activeFilter.value}`
    : null
  const scopedLabels = [
    activeFilter ? `${activeFilter.kind === 'tag' ? 'タグ' : 'コーナー'}「${activeFilter.value}」` : null,
    parsedDisplay.label ?? (year ? `${year}年` : null),
  ].filter(Boolean)
  const scopedLabel = scopedLabels.join(' / ')
  const sectionTitle = isSearching
    ? textQueryDisplay
      ? `「${textQueryDisplay}」の検索結果${scopedLabel ? ` (${scopedLabel})` : ''}`
      : scopedLabel
        ? `${scopedLabel}の配信`
        : '検索結果'
    : activeFilter
      ? `${scopedLabel}${view === 'top' ? 'の配信' : `の${currentLabel}`}`
      : view === 'top'
        ? year ? `${year}年の配信` : '最近の配信'
        : `${currentLabel}${year ? ` (${year}年)` : ''}`

  const handleFilterSelect = useCallback((kind: 'tag' | 'corner', value: string) => {
    setActiveFilter((current) => {
      if (current?.kind === kind && current.value === value) {
        return null
      }
      return { kind, value }
    })
  }, [])

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="max-w-3xl space-y-3">
            <p className="max-w-2xl text-sm leading-7 text-gray-300 sm:text-base">
              山口一郎のYouTubeライブ配信を、人物名・日付・話題からあとで探せるアーカイブ。
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>{isSearching ? '検索結果' : '配信'} {resultCount.toLocaleString()}件</span>
              {latestUpdatedAt && <span>最終更新 {formatUpdatedAt(latestUpdatedAt)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        <nav className="flex gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => { setView(cat.key); setQuery('') }}
              className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
                view === cat.key && !isSearching
                  ? 'bg-blue-950 border border-blue-500 text-blue-300 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                  : 'bg-transparent border border-gray-700 text-gray-400 hover:border-blue-500 hover:text-blue-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-6 space-y-4">
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

        {activeFilterLabel && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">絞り込み：</span>
            <button
              type="button"
              onClick={() => setActiveFilter(null)}
              className="rounded-full border border-indigo-800 bg-indigo-950 px-2.5 py-1 text-xs text-indigo-200 transition hover:border-indigo-700 hover:bg-indigo-900"
            >
              {activeFilterLabel} ×
            </button>
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
                <p className="text-gray-300 font-semibold">日付・期間検索</p>
                <p>「2026年2月」のように入力すると、その月の配信に絞り込まれます。キーワードと組み合わせも可能です。</p>
                <div className="font-mono text-gray-500 space-y-0.5">
                  <p><span className="text-gray-300">2026年2月</span> → 2月の配信一覧</p>
                  <p><span className="text-gray-300">2026年2月 浜田</span> → 2月 × 浜田</p>
                </div>
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
              {sectionTitle}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">表示中 {streams.length.toLocaleString()}件 / 全{resultCount.toLocaleString()}件</p>
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
              <StreamCard
                key={s.id}
                stream={s}
                rank={showRank ? i + 1 : undefined}
                onFilterSelect={handleFilterSelect}
              />
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
