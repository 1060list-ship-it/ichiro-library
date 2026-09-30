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
  const pendingSearchLogQueryRef = useRef(initialState.query.trim() || null)
  const hasLoggedInitialSearchRef = useRef(false)

  const [view, setView] = useState(initialState.view)
  const [query, setQuery] = useState(initialState.query)
  const [debouncedQuery, setDebouncedQuery] = useState(initialState.query)
  const [fuzzy, setFuzzy] = useState(initialState.fuzzy)
  const [year, setYear] = useState(initialState.year)
  const [activeFilter, setActiveFilter] = useState<ActiveCardFilter | null>(initialState.activeFilter)
  const [tagOptions, setTagOptions] = useState<{ slug: string; label: string }[]>([])
  const [cornerOptions, setCornerOptions] = useState<string[]>([])
  const [availableYears] = useState(initialAvailableYears)
  const [streams, setStreams] = useState(initialStreams)
  const [resultCount, setResultCount] = useState(initialResultCount)
  const [latestUpdatedAt] = useState(initialLatestUpdatedAt)
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

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

  const logSearch = useCallback((searchQuery: string, matchedCount: number) => {
    void supabase
      .from('search_logs')
      .insert({
        query: searchQuery,
        result_count: matchedCount,
        user_id: currentUserId,
      })
      .then(({ error }) => {
        if (error) {
          console.error('Failed to insert search log', error)
        }
      })
  }, [currentUserId])

  useEffect(() => {
    const trimmedQuery = debouncedQuery.trim()
    pendingSearchLogQueryRef.current = trimmedQuery.length > 0 ? trimmedQuery : null
  }, [debouncedQuery])

  const fetchStreams = useCallback(async () => {
    setLoading(true)
    const trimmedQuery = debouncedQuery.trim()
    const shouldLogSearch =
      trimmedQuery.length > 0 && pendingSearchLogQueryRef.current === trimmedQuery

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

    if (shouldLogSearch) {
      pendingSearchLogQueryRef.current = null
      logSearch(trimmedQuery, result.resultCount)
    }
  }, [activeFilter, debouncedQuery, fuzzy, logSearch, view, year])

  useEffect(() => {
    let cancelled = false

    async function loadFilterOptions() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client: any = supabase
      const [tagRes, cornerRes] = await Promise.all([
        client.from('tag_vocabulary').select('slug,label').eq('is_active', true).order('sort_order'),
        client.from('streams').select('corner_names').not('corner_names', 'is', null).limit(2000),
      ])

      if (cancelled) {
        return
      }

      setTagOptions((tagRes.data ?? []) as { slug: string; label: string }[])
      const corners = new Set<string>()
      for (const row of (cornerRes.data ?? []) as { corner_names: string[] | null }[]) {
        for (const corner of row.corner_names ?? []) {
          corners.add(corner)
        }
      }
      setCornerOptions([...corners].sort((a, b) => a.localeCompare(b, 'ja')))
    }

    void loadFilterOptions()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isFirstFetch.current) {
      isFirstFetch.current = false
      return
    }

    void fetchStreams()
  }, [fetchStreams])

  useEffect(() => {
    if (hasLoggedInitialSearchRef.current) {
      return
    }

    hasLoggedInitialSearchRef.current = true

    const trimmedQuery = debouncedQuery.trim()
    if (trimmedQuery.length === 0) {
      pendingSearchLogQueryRef.current = null
      return
    }

    pendingSearchLogQueryRef.current = null
    logSearch(trimmedQuery, resultCount)
  }, [debouncedQuery, logSearch, resultCount])

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
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="hero-aurora">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:py-24">
          <div className="max-w-[760px] space-y-4 lg:mx-auto lg:text-center">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--aqua)] lg:text-xs">LIVE ARCHIVE</p>
            <h1 className="hero-title">
              <span className="block">FIND TONIGHT&apos;S</span>
              <span className="hero-title-accent block">ICHIRO.</span>
            </h1>
            <p className="text-[15px] font-medium leading-7 tracking-[.01em] text-[var(--ink)] sm:text-base lg:text-lg lg:leading-[1.7]">山口一郎の配信から、今夜観たい一回を探す。</p>
          </div>
          <div className="mt-8 max-w-[760px] space-y-4 sm:mt-10 lg:mx-auto">
            <div className="hero-search-frame">
              <div className="hero-search-frame-inner">
                <SearchBar value={query} onChange={setQuery} fuzzy={fuzzy} onFuzzyChange={setFuzzy} />
              </div>
            </div>
            <div>
              <button type="button" onClick={() => setShowHelp((value) => !value)} className="min-h-11 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]">
                {showHelp ? '▾' : '▸'} 検索の使い方
              </button>
              {showHelp && (
                <div className="mt-2 space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs leading-6 text-[var(--muted)]">
                  <div className="space-y-1.5"><p className="font-semibold text-[var(--ink)]">キーワード検索</p><p>入力したキーワードをタイトル・要約から検索します。スペース区切りは OR 検索です。</p></div>
                  <div className="space-y-1.5"><p className="font-semibold text-[var(--ink)]">除外検索</p><p><span className="font-mono text-[var(--ink)]">-</span> を先頭につけたキーワードを含む配信を除外します。</p></div>
                  <div className="space-y-1.5"><p className="font-semibold text-[var(--ink)]">あいまい検索</p><p>表記ゆれや関連語もまとめてヒットします。</p></div>
                  <div className="space-y-1.5"><p className="font-semibold text-[var(--ink)]">日付・期間検索</p><p>「2026年2月」「2026-02-14」のように入力すると、その月・日の配信に絞り込まれます。</p></div>
                  <Link href="/entity" className="text-[var(--aqua)] underline">人物索引を見る →</Link>
                </div>
              )}
            </div>
          </div>
          <div className="mt-8 grid grid-cols-3 sm:mt-10">
            <div className="hero-stat has-tip flex min-w-0 flex-col px-2 outline-none first:pl-0 sm:px-4 sm:first:pl-0 lg:items-center" tabIndex={0} data-tip="配信アーカイブ総数">
              <span className="hero-stat-value">321</span>
              <span className="hero-stat-label">ARCHIVES</span>
            </div>
            <div className="hero-stat has-tip flex min-w-0 flex-col px-2 outline-none sm:px-4 lg:items-center" tabIndex={0} data-tip="総再生回数">
              <span className="hero-stat-value">58,044,318</span>
              <span className="hero-stat-label">VIEWS</span>
            </div>
            <div className="hero-stat has-tip flex min-w-0 flex-col px-2 pr-0 outline-none sm:px-4 sm:pr-0 lg:items-center" tabIndex={0} data-tip="総配信時間">
              <span className="hero-stat-value">671</span>
              <span className="hero-stat-label">HOURS</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <nav className="grid grid-cols-4 border-b border-[var(--line)]" aria-label="配信カテゴリ">
          {HOME_CATEGORIES.map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => {
                setView(category.key)
                setQuery('')
              }}
              className={`min-h-11 border-b-2 px-1 text-xs font-medium transition-colors sm:text-sm ${
                view === category.key && !isSearching
                  ? 'border-[var(--aqua)] text-[var(--ink)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {category.label}
            </button>
          ))}
        </nav>
        {availableYears.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-[var(--muted)]">期間</span>
            <button
              type="button"
              onClick={() => setYear(null)}
              className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
                year === null
                  ? 'border-[var(--aqua)] text-[var(--ink)]'
                  : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--aqua)]'
              }`}
            >
              全期間
            </button>
            {availableYears.map((availableYear) => (
              <button
                key={availableYear}
                type="button"
                onClick={() => setYear(year === availableYear ? null : availableYear)}
                className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
                  year === availableYear
                    ? 'border-[var(--aqua)] text-[var(--ink)]'
                    : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--aqua)]'
                }`}
              >
                {availableYear}年
              </button>
            ))}
          </div>
        )}

        {(tagOptions.length > 0 || cornerOptions.length > 0) && (
          <div className="space-y-4">
            <button type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} className="min-h-11 rounded-full border border-[var(--line)] px-4 text-sm text-[var(--ink)] transition hover:border-[var(--aqua)]">絞り込む（タグ・コーナー） {showFilters ? '▴' : '▾'}</button>
            {showFilters && (
              <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            {tagOptions.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-[var(--muted)]">タグ</span>
            {tagOptions.map((tag) => {
              const selected = activeFilter?.kind === 'tag' && activeFilter.value === tag.slug
              return (
                <button
                  key={tag.slug}
                  type="button"
                  onClick={() => handleFilterSelect('tag', tag.slug)}
                  aria-pressed={selected}
                  className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
                    selected
                      ? 'border-[var(--aqua)] text-[var(--ink)]'
                      : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--aqua)]'
                  }`}
                >
                  {tag.label}
                </button>
              )
            })}
              </div>
            }

            {cornerOptions.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
            <span className="shrink-0 text-xs text-[var(--muted)]">コーナー</span>
            {cornerOptions.map((corner) => {
              const selected = activeFilter?.kind === 'corner' && activeFilter.value === corner
              return (
                <button
                  key={corner}
                  type="button"
                  onClick={() => handleFilterSelect('corner', corner)}
                  aria-pressed={selected}
                  className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
                    selected
                      ? 'border-[var(--aqua)] text-[var(--ink)]'
                      : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--aqua)]'
                  }`}
                >
                  {corner}
                </button>
              )
            })}
          </div>}
          </div>)}
          </div>
        )}

        {(activeFilterLabel || query || year) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--muted)]">選択中</span>
            {query && <button type="button" onClick={() => setQuery('')} className="min-h-9 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink)]">「{query}」×</button>}
            {year && <button type="button" onClick={() => setYear(null)} className="min-h-9 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink)]">{year}年 ×</button>}
            {activeFilterLabel && (
            <button
              type="button"
              onClick={() => setActiveFilter(null)}
              className="min-h-9 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink)] transition hover:border-[var(--aqua)]"
            >
              {activeFilterLabel} ×
            </button>
            )}
            <button type="button" onClick={() => { setQuery(''); setYear(null); setActiveFilter(null) }} className="min-h-9 text-xs text-[var(--aqua)]">全解除</button>
          </div>
        )}

        <div className="flex items-start gap-3">
          {view !== 'top' && !isSearching && (
            <button
              type="button"
              onClick={() => setView('top')}
              className="mt-0.5 shrink-0 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            >
              ← TOP
            </button>
          )}
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">{sectionTitle}</h2>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-[var(--muted)]">
              表示中 {streams.length.toLocaleString()}件 / 全{resultCount.toLocaleString()}件
              {latestUpdatedAt && ` / 最終更新 ${formatUpdatedAt(latestUpdatedAt)}`}
            </p>
          </div>
        </div>

        {loading ? (
          <p className="rounded-2xl bg-[var(--surface)] py-12 text-center text-sm text-[var(--muted)]">読み込み中...</p>
        ) : streams.length === 0 ? (
          <div className="rounded-2xl bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--muted)]">
            <p>{isSearching ? '該当する配信が見つかりません' : '該当する配信がまだありません'}</p>
            <button type="button" onClick={() => { setQuery(''); setYear(null); setActiveFilter(null) }} className="mt-3 text-xs text-[var(--aqua)]">検索条件を解除する</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <footer className="footer-glow mt-12 px-4 py-6 text-center text-xs text-[var(--muted)]">
        <p>管理者: <a href="https://x.com/ikki_i" target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--ink)]">ikki</a></p>
        <p className="mt-1">非公式ファンサイト。サカナクション・山口一郎とは無関係です。</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/about" className="underline hover:text-[var(--ink)]">このサービスについて</Link>
          <Link href="/privacy" className="underline hover:text-[var(--ink)]">プライバシーポリシー</Link>
        </p>
      </footer>
    </main>
  )
}
