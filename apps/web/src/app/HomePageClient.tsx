'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import StreamCard from '@/components/StreamCard'
import SearchBar from '@/components/SearchBar'
import {
  type ActiveCardFilter,
  type HomePageState,
  type HomeStream,
  HOME_CATEGORIES,
  fetchHomePageStreams,
  parseJapaneseDateFromQuery,
} from '@/lib/home-page'
import { supabase } from '@/lib/supabase'

type Props = {
  initialState: HomePageState
  initialStreams: HomeStream[]
  initialResultCount: number
  initialAvailableYears: number[]
  initialLatestUpdatedAt: string | null
  currentUserId: string | null
  bookmarkedStreamIds: string[]
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

export default function HomePageClient({
  initialState,
  initialStreams,
  initialResultCount,
  initialAvailableYears,
  initialLatestUpdatedAt,
  currentUserId,
  bookmarkedStreamIds,
}: Props) {
  const router = useRouter()
  const isFirstFetch = useRef(true)

  const [view, setView] = useState(initialState.view)
  const [query, setQuery] = useState(initialState.query)
  const [debouncedQuery, setDebouncedQuery] = useState(initialState.query)
  const [fuzzy, setFuzzy] = useState(initialState.fuzzy)
  const [year, setYear] = useState(initialState.year)
  const [activeFilter, setActiveFilter] = useState<ActiveCardFilter | null>(initialState.activeFilter)
  const [availableYears] = useState(initialAvailableYears)
  const [streams, setStreams] = useState(initialStreams)
  const [resultCount, setResultCount] = useState(initialResultCount)
  const [latestUpdatedAt] = useState(initialLatestUpdatedAt)
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedQuery(query), 400)
    return () => window.clearTimeout(timeoutId)
  }, [query])

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)

      setView(params.get('view') ?? 'top')
      setQuery(params.get('q') ?? '')
      setDebouncedQuery(params.get('q') ?? '')
      setFuzzy(params.get('fuzzy') === '1')

      const nextYear = params.get('year')
      setYear(nextYear ? Number.parseInt(nextYear, 10) : null)

      const tag = params.get('tag')
      const corner = params.get('corner')
      setActiveFilter(tag ? { kind: 'tag', value: tag } : corner ? { kind: 'corner', value: corner } : null)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()

    if (query) params.set('q', query)
    if (view !== 'top') params.set('view', view)
    if (fuzzy) params.set('fuzzy', '1')
    if (year !== null) params.set('year', String(year))
    if (activeFilter?.kind === 'tag') params.set('tag', activeFilter.value)
    if (activeFilter?.kind === 'corner') params.set('corner', activeFilter.value)

    const queryString = params.toString()
    router.replace(queryString ? `?${queryString}` : '/', { scroll: false })
  }, [query, view, fuzzy, year, activeFilter, router])

  const fetchStreams = useCallback(async () => {
    setLoading(true)

    const result = await fetchHomePageStreams(supabase, {
      view,
      query: debouncedQuery,
      fuzzy,
      year,
      activeFilter,
    })

    setStreams(result.streams)
    setResultCount(result.resultCount)
    setLoading(false)
  }, [activeFilter, debouncedQuery, fuzzy, view, year])

  useEffect(() => {
    if (isFirstFetch.current) {
      isFirstFetch.current = false
      return
    }

    void fetchStreams()
  }, [fetchStreams])

  const isSearching = debouncedQuery.trim().length > 0
  const parsedDisplay = parseJapaneseDateFromQuery(debouncedQuery.trim())
  const textQueryDisplay = parsedDisplay.remaining.trim()
  const currentCategory = HOME_CATEGORIES.find((category) => category.key === view)
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

  const bookmarkedStreamIdSet = new Set(bookmarkedStreamIds)

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
          {HOME_CATEGORIES.map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => {
                setView(category.key)
                setQuery('')
              }}
              className={`flex-1 rounded-full py-2 text-sm font-medium transition-colors ${
                view === category.key && !isSearching
                  ? 'border border-blue-500 bg-blue-950 text-blue-300 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                  : 'border border-gray-700 bg-transparent text-gray-400 hover:border-blue-500 hover:text-blue-300'
              }`}
            >
              {category.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-6">
        <SearchBar value={query} onChange={setQuery} fuzzy={fuzzy} onFuzzyChange={setFuzzy} />

        {availableYears.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-gray-500">期間：</span>
            <button
              type="button"
              onClick={() => setYear(null)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                year === null
                  ? 'bg-indigo-600 font-semibold text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              全期間
            </button>
            {availableYears.map((availableYear) => (
              <button
                key={availableYear}
                type="button"
                onClick={() => setYear(year === availableYear ? null : availableYear)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  year === availableYear
                    ? 'bg-indigo-600 font-semibold text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {availableYear}年
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

        <div>
          <button
            type="button"
            onClick={() => setShowHelp((value) => !value)}
            className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            <span>{showHelp ? '▾' : '▸'}</span>
            <span>検索の使い方</span>
          </button>
          {showHelp && (
            <div className="mt-2 space-y-3 rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-400">
              <div className="space-y-1.5">
                <p className="font-semibold text-gray-300">キーワード検索</p>
                <p>入力したキーワードをタイトル・要約から検索します。</p>
                <p>スペース区切りで複数入力すると <span className="font-mono text-white">OR</span> 検索になります。</p>
                <div className="space-y-0.5 font-mono text-gray-500">
                  <p><span className="text-gray-300">浜田 ハマダ</span> → どちらかにヒットするものを表示</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-gray-300">除外検索</p>
                <p><span className="font-mono text-white">-</span> を先頭につけたキーワードを含む配信を除外します。</p>
                <div className="space-y-0.5 font-mono text-gray-500">
                  <p><span className="text-gray-300">浜田 -ゲーム</span> → 浜田を含み、ゲームを含まない</p>
                  <p><span className="text-gray-300">-深夜 -歌</span> → 深夜と歌を両方除外</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-gray-300">あいまい検索</p>
                <p>検索欄右のトグルをオンにすると、表記ゆれや関連語もまとめてヒットします。</p>
                <p className="text-gray-500">例：「さかな」で「サカナクション」もヒット</p>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-gray-300">日付・期間検索</p>
                <p>「2026年2月」のように入力すると、その月の配信に絞り込まれます。キーワードと組み合わせも可能です。</p>
                <div className="space-y-0.5 font-mono text-gray-500">
                  <p><span className="text-gray-300">2026年2月</span> → 2月の配信一覧</p>
                  <p><span className="text-gray-300">2026年2月 浜田</span> → 2月 × 浜田</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-gray-300">人物・エンティティ検索</p>
                <p>登録済みの人物名や別名でも検索できます。テキストに名前が出ていない配信でも、エンティティとして紐付けられていれば表示されます。</p>
                <p className="mt-1">
                  <Link href="/entity" className="text-indigo-400 underline hover:text-indigo-300">
                    人物索引を見る →
                  </Link>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-start gap-3">
          {view !== 'top' && !isSearching && (
            <button
              type="button"
              onClick={() => setView('top')}
              className="mt-0.5 shrink-0 text-xs text-gray-400 hover:text-white"
            >
              ← TOP
            </button>
          )}
          <div>
            <h2 className="text-sm font-semibold text-gray-300">{sectionTitle}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              表示中 {streams.length.toLocaleString()}件 / 全{resultCount.toLocaleString()}件
            </p>
          </div>
        </div>

        {loading ? (
          <p className="py-12 text-center text-gray-500">読み込み中...</p>
        ) : streams.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">
            {isSearching ? '該当する配信が見つかりません' : '該当する配信がまだありません'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {streams.map((stream, index) => (
              <StreamCard
                key={`${stream.id}:${bookmarkedStreamIdSet.has(stream.id) ? '1' : '0'}`}
                stream={stream}
                rank={showRank ? index + 1 : undefined}
                onFilterSelect={handleFilterSelect}
                currentUserId={currentUserId}
                isBookmarked={bookmarkedStreamIdSet.has(stream.id)}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="mt-12 border-t border-gray-800 px-4 py-6 text-center text-xs text-gray-500">
        <p>管理者: <a href="https://x.com/ikki_i" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">ikki</a></p>
        <p className="mt-1">非公式ファンサイト。サカナクション・山口一郎とは無関係です。</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/about" className="underline hover:text-gray-300">このサービスについて</Link>
          <Link href="/privacy" className="underline hover:text-gray-300">プライバシーポリシー</Link>
        </p>
      </footer>
    </main>
  )
}
