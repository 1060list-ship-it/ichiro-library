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

  if (loading) return <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">読み込み中...</div>

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-[var(--muted)] hover:text-[var(--ink)]">← 配信一覧</Link>
        <div className="mt-6 space-y-3">
          <p className="text-xs font-medium tracking-[0.14em] text-[var(--aqua)]">WEEKLY MAGAZINE</p>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-4xl">いっくん追いかけマガジン</h1>
          <p className="text-sm leading-7 text-[var(--muted)]">配信とその週の出来事を、あとからたどる。</p>
        </div>
        <div className="mt-10">
        {magazines.length === 0 ? (
          <div className="space-y-2 rounded-2xl bg-[var(--surface)] py-12 text-center">
            {error ? (
              <>
                <p className="text-sm text-[var(--signal)]">マガジンを読み込めませんでした</p>
                <p className="text-xs text-[var(--muted)]">{error}</p>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">まだマガジンがありません</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {magazines.map(mag => {
              const start = new Date(mag.week_start).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
              const end = new Date(mag.week_end).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
              const magazineNumber = formatMagazineNumber(mag.week_label)
              const coverImageUrl = getMagazineCoverUrl(mag.week_label, mag.cover_image_url)
              return (
                <Link key={mag.id} href={`/magazine/${mag.week_label}`}
                  className="group grid grid-cols-[88px_1fr] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] transition hover:border-[var(--aqua)] sm:block">
                  <div className="relative h-[124px] w-[88px] shrink-0 self-center overflow-hidden bg-[var(--surface-raised)] sm:h-auto sm:w-full sm:self-auto sm:aspect-[210/297]">
                    {coverImageUrl ? (
                      <img src={coverImageUrl} alt={mag.content.headline}
                        className="absolute inset-0 h-full w-full object-cover object-top" />
                    ) : (
                      <div className="flex h-full w-full flex-col justify-between px-3 py-3 text-[var(--muted)]">
                        <span className="text-[10px] font-semibold tracking-[0.14em] leading-tight">ICHIRO<br />LIBRARY</span>
                        <span className="font-mono text-[10px] font-bold">{magazineNumber}</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 space-y-3 p-4">
                    <p className="font-mono text-xs tabular-nums text-[var(--muted)]">{start} — {end}</p>
                    <p className="line-clamp-2 text-base font-semibold leading-snug text-[var(--ink)]">
                      {mag.content.headline}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {mag.content.topics.slice(0, 2).map((t, i) => (
                        <span key={i} className="rounded-full border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)]">
                          {t.title}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--aqua)]">読む →</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
      </div>
    </main>
  )
}
