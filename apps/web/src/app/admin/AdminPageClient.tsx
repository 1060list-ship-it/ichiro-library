'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { AdminDashboardData, AdminListStream, EnqueueJobInput, PipelineJob, SearchLogStats } from './actions'
import {
  cancelPipelineJob,
  clearFinishedJobs,
  deletePipelineJob,
  enqueueJob,
  fetchAdminDashboard,
  fetchAdminStreamsPage,
  fetchBookmarkedStreams,
  fetchRecentJobs,
  searchAdminStreams,
  setAdminStreamReviewed,
} from './actions'

type AdminBookmarkedStream = Awaited<ReturnType<typeof fetchBookmarkedStreams>>[number]

const UNREVIEWED_INITIAL_LIMIT = 5

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatSearchLogDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`)

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
    })
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatStatus(status: string) {
  if (status === 'transcript_failed') return '字幕取得失敗'
  if (status === 'completed') return '処理完了'
  if (status === 'pending') return '処理待ち'
  return status
}

function formatJobKind(kind: string) {
  if (kind === 'fetch_new') return '新規取り込み'
  if (kind === 'reprocess') return '字幕エラー再試行'
  if (kind === 'reprocess_single') return '単体再処理'
  if (kind === 'weekly_magazine') return 'マガジン生成'
  return kind
}

function JobStatusBadge({ status }: { status: string }) {
  const className = status === 'pending'
    ? 'border-gray-700 bg-gray-800 text-gray-200'
    : status === 'running'
      ? 'border-yellow-700 bg-yellow-500/10 text-yellow-300 animate-pulse'
      : status === 'done'
        ? 'border-emerald-800 bg-emerald-500/10 text-emerald-300'
        : status === 'failed'
          ? 'border-red-800 bg-red-500/10 text-red-300'
          : status === 'cancelled'
            ? 'border-gray-600 bg-gray-800 text-gray-500'
            : 'border-gray-700 bg-gray-800 text-gray-200'

  const label = status === 'pending' ? '処理待ち'
    : status === 'running' ? '処理中'
    : status === 'done' ? '完了'
    : status === 'failed' ? 'エラー'
    : status === 'cancelled' ? 'キャンセル'
    : status

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

function StreamRow({
  stream,
  toggling,
  onToggleReviewed,
}: {
  stream: AdminListStream
  toggling?: boolean
  onToggleReviewed: (stream: AdminListStream, nextValue: boolean) => void
}) {
  return (
    <div className="grid grid-cols-[160px_1fr_auto] items-center gap-4 px-5 py-4">
      <div className="aspect-video overflow-hidden rounded-lg bg-gray-950">
        {stream.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stream.thumbnail_url}
            alt={stream.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-600">
            no image
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-white">{stream.title}</p>
          {stream.needs_manual_review && (
            <span className="flex-shrink-0 rounded-full bg-rose-900/60 border border-rose-700 px-2 py-0.5 text-xs text-rose-300">
              要目視
            </span>
          )}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-gray-400">
          <span>{formatDate(stream.stream_date)}</span>
          <span>{formatStatus(stream.status)}</span>
          <span>{stream.is_reviewed ? '確認済み' : '未レビュー'}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">{stream.video_id}</p>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">確認済み</span>
          <button
            type="button"
            role="switch"
            aria-checked={stream.is_reviewed}
            disabled={toggling}
            onClick={() => onToggleReviewed(stream, !stream.is_reviewed)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
              stream.is_reviewed ? 'bg-white' : 'bg-gray-700'
            } ${toggling ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-gray-950 transition ${
                stream.is_reviewed ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <Link
          href={`/stream/${stream.video_id}`}
          className="text-sm text-gray-300 underline decoration-gray-700 underline-offset-4 hover:text-white"
        >
          ページを見る
        </Link>
        <Link
          href={`/admin/stream/${stream.video_id}`}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
        >
          編集
        </Link>
      </div>
    </div>
  )
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value.toLocaleString()}</p>
    </>
  )
  if (href && value > 0) {
    return (
      <a href={href} className="block rounded-lg border border-gray-700 bg-gray-900 p-4 transition hover:border-gray-500">
        {inner}
      </a>
    )
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      {inner}
    </div>
  )
}

function JobTable({
  jobs,
  cancellingJobId,
  deletingJobId,
  onCancel,
  onDelete,
}: {
  jobs: PipelineJob[]
  cancellingJobId: string | null
  deletingJobId: string | null
  onCancel: (jobId: string) => void
  onDelete: (jobId: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-800 text-sm">
        <thead className="bg-gray-950/40 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-5 py-3 font-medium">種別</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Requested</th>
            <th className="px-5 py-3 font-medium">Started</th>
            <th className="px-5 py-3 font-medium">Finished</th>
            <th className="px-5 py-3 font-medium">Error</th>
            <th className="px-5 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {jobs.map((job) => (
            <tr key={job.id} className="align-top">
              <td className="px-5 py-4 text-gray-200">
                {job.video_id ? (
                  <Link href={`/admin/stream/${job.video_id}`} className="hover:underline">
                    {formatJobKind(job.kind)}
                  </Link>
                ) : (
                  <div>{formatJobKind(job.kind)}</div>
                )}
                {job.video_id && (
                  <div className="mt-1 text-xs text-gray-500">{job.video_id}</div>
                )}
              </td>
              <td className="px-5 py-4">
                <JobStatusBadge status={job.status} />
              </td>
              <td className="px-5 py-4 text-gray-300">{formatDateTime(job.requested_at)}</td>
              <td className="px-5 py-4 text-gray-300">{formatDateTime(job.started_at)}</td>
              <td className="px-5 py-4 text-gray-300">{formatDateTime(job.finished_at)}</td>
              <td className="px-5 py-4 text-gray-400" title={job.error_msg ?? ''}>
                {job.error_msg ? (
                  <span className="block max-w-xs truncate">{job.error_msg}</span>
                ) : (
                  '-'
                )}
              </td>
              <td className="px-5 py-4">
                <div className="flex flex-col gap-1">
                  {job.status === 'pending' && (
                    <button
                      type="button"
                      disabled={cancellingJobId === job.id}
                      onClick={() => onCancel(job.id)}
                      className="text-xs text-gray-400 hover:text-white disabled:opacity-40"
                    >
                      {cancellingJobId === job.id ? '取り消し中...' : '取り消し'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={deletingJobId === job.id}
                    onClick={() => onDelete(job.id)}
                    className="text-xs text-red-500 hover:text-red-300 disabled:opacity-40"
                  >
                    {deletingJobId === job.id ? '削除中...' : '削除'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminPageClient({
  logoutAction,
  initialSearchLogStats,
  searchLogStatsError,
}: {
  logoutAction: () => Promise<void>
  initialSearchLogStats: SearchLogStats
  searchLogStatsError: string | null
}) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStartDate, setSearchStartDate] = useState('')
  const [searchEndDate, setSearchEndDate] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchResults, setSearchResults] = useState<AdminListStream[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [allStreams, setAllStreams] = useState<AdminListStream[]>([])
  const [allStreamsLoading, setAllStreamsLoading] = useState(true)
  const [allStreamsError, setAllStreamsError] = useState('')
  const [allStreamsHasMore, setAllStreamsHasMore] = useState(false)
  const [togglingVideoIds, setTogglingVideoIds] = useState<string[]>([])
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState('')
  const [jobActionError, setJobActionError] = useState('')
  const [jobSubmittingKind, setJobSubmittingKind] = useState<string | null>(null)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const [clearingJobs, setClearingJobs] = useState(false)
  const [bookmarks, setBookmarks] = useState<AdminBookmarkedStream[]>([])
  const [bookmarksLoading, setBookmarksLoading] = useState(true)
  const [bookmarksError, setBookmarksError] = useState('')
  const [showAllUnreviewed, setShowAllUnreviewed] = useState(false)

  const loadDashboardData = useCallback(async () => {
    try {
      const data = await fetchAdminDashboard()
      setDashboard(data)
      setLoadError('')
    } catch {
      setLoadError('管理データの取得に失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadInitialStreams = useCallback(async () => {
    try {
      const result = await fetchAdminStreamsPage(0, 20)
      setAllStreams(result.streams)
      setAllStreamsHasMore(result.hasMore)
      setAllStreamsError('')
    } catch {
      setAllStreamsError('全動画一覧の取得に失敗しました。')
    } finally {
      setAllStreamsLoading(false)
    }
  }, [])

  const loadJobs = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setJobsLoading(true)
    }
    try {
      const data = await fetchRecentJobs(10)
      setJobs(data)
      setJobsError('')
    } catch {
      setJobsError('ジョブ一覧の取得に失敗しました。')
    } finally {
      setJobsLoading(false)
    }
  }, [])

  const loadBookmarks = useCallback(async () => {
    try {
      const data = await fetchBookmarkedStreams()
      setBookmarks(data)
      setBookmarksError('')
    } catch {
      setBookmarksError('ブックマークの取得に失敗しました。')
    } finally {
      setBookmarksLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void Promise.all([loadDashboardData(), loadInitialStreams(), loadJobs(), loadBookmarks()])
    })
  }, [loadDashboardData, loadInitialStreams, loadJobs, loadBookmarks])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadJobs()
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [loadJobs])

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setSearching(true)
    setSearchError('')
    setHasSearched(true)

    try {
      const data = await searchAdminStreams({
        query: searchQuery,
        startDate: searchStartDate,
        endDate: searchEndDate,
        limit: 20,
      })
      setSearchResults(data)
    } catch {
      setSearchError('検索に失敗しました。')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  async function handleLoadMore() {
    setAllStreamsLoading(true)
    setAllStreamsError('')

    try {
      const result = await fetchAdminStreamsPage(allStreams.length, 20)
      setAllStreams((prev) => [...prev, ...result.streams])
      setAllStreamsHasMore(result.hasMore)
    } catch {
      setAllStreamsError('続きを取得できませんでした。')
    } finally {
      setAllStreamsLoading(false)
    }
  }

  async function handleToggleReviewed(stream: AdminListStream, nextValue: boolean) {
    setTogglingVideoIds((prev) => [...prev, stream.video_id])

    try {
      const updated = await setAdminStreamReviewed(stream.video_id, nextValue)

      setDashboard((prev) => {
        if (!prev) return prev

        const nextUnreviewedStreams = updated.is_reviewed
          ? prev.unreviewedStreams.filter((item) => item.video_id !== updated.video_id)
          : [updated, ...prev.unreviewedStreams.filter((item) => item.video_id !== updated.video_id)]

        const nextFailedStreams = prev.failedStreams.map((item) =>
          item.video_id === updated.video_id ? updated : item
        )

        return {
          ...prev,
          summary: {
            ...prev.summary,
            unreviewedCount: Math.max(0, prev.summary.unreviewedCount + (updated.is_reviewed ? -1 : 1)),
          },
          unreviewedStreams: nextUnreviewedStreams,
          failedStreams: nextFailedStreams,
        }
      })

      setAllStreams((prev) => prev.map((item) => (item.video_id === updated.video_id ? updated : item)))
      setSearchResults((prev) => prev.map((item) => (item.video_id === updated.video_id ? updated : item)))
    } catch {
      setLoadError('レビュー状態の更新に失敗しました。')
    } finally {
      setTogglingVideoIds((prev) => prev.filter((id) => id !== stream.video_id))
    }
  }

  async function handleEnqueueJob(input: EnqueueJobInput) {
    setJobSubmittingKind(input.kind)
    setJobActionError('')

    try {
      const created = await enqueueJob(input)
      setJobs((prev) => [created, ...prev].slice(0, 10))
      await loadJobs()
    } catch {
      setJobActionError('ジョブ登録に失敗しました。')
    } finally {
      setJobSubmittingKind(null)
    }
  }

  async function handleDeleteJob(jobId: string) {
    setDeletingJobId(jobId)
    setJobActionError('')
    try {
      await deletePipelineJob(jobId)
      setJobs((prev) => prev.filter((job) => job.id !== jobId))
    } catch {
      setJobActionError('ジョブの削除に失敗しました。')
    } finally {
      setDeletingJobId(null)
    }
  }

  async function handleClearFinishedJobs() {
    setClearingJobs(true)
    try {
      await clearFinishedJobs()
      await loadJobs()
    } catch {
      setJobActionError('完了済みジョブの削除に失敗しました。')
    } finally {
      setClearingJobs(false)
    }
  }

  async function handleCancelJob(jobId: string) {
    setCancellingJobId(jobId)
    setJobActionError('')

    try {
      await cancelPipelineJob(jobId)
      setJobs((prev) => prev.map((job) => (
        job.id === jobId ? { ...job, status: 'cancelled' } : job
      )))
      await loadJobs()
    } catch {
      setJobActionError('ジョブの取り消しに失敗しました。')
    } finally {
      setCancellingJobId(null)
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">ichiro library 管理画面</h1>
            <p className="mt-1 text-sm text-gray-400">配信メタデータの確認と手動修正</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-gray-500 transition hover:text-gray-300"
            >
              ← トップへ
            </Link>
            <Link
              href="/member"
              className="text-sm text-gray-500 transition hover:text-gray-300"
            >
              プレイリスト管理
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {loading ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <p className="text-sm text-gray-500">管理データを読み込み中...</p>
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-red-900 bg-red-950/30 p-6">
            <p className="text-sm text-red-300">{loadError}</p>
          </div>
        ) : dashboard ? (
          <>
            <section className="flex justify-end">
              <Link
                href="/admin/entity"
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
              >
                エンティティ管理 →
              </Link>
            </section>

            <section className="grid grid-cols-3 gap-4">
              <StatCard label="登録動画数" value={dashboard.summary.totalCount} />
              <StatCard label="未レビュー数" value={dashboard.summary.unreviewedCount} />
              <StatCard label="字幕取得失敗数" value={dashboard.summary.transcriptFailedCount} href="#failed-streams" />
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="border-b border-gray-800 px-5 py-4">
                <h2 className="text-base font-semibold">パイプライン操作</h2>
                <p className="mt-1 text-sm text-gray-400">管理画面から取り込みと再処理をキューに登録します。</p>
              </div>

              <div className="space-y-4 px-5 py-4">
                <dl className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/50 p-4 text-sm text-gray-400 md:grid-cols-2">
                  <div>
                    <dt className="font-medium text-gray-200">新規動画を取り込む</dt>
                    <dd className="mt-1">直近30日・最大20件を対象に新着取り込みジョブを積む。</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-200">字幕取得に失敗した動画を再試行</dt>
                    <dd className="mt-1">`transcript_failed` の配信をまとめて再処理キューへ送る。</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-200">今週のマガジンを生成</dt>
                    <dd className="mt-1">週次マガジン生成ジョブを追加して、表紙と本文の更新を走らせる。</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-200">ジョブ一覧を更新</dt>
                    <dd className="mt-1">最新10件の実行状態を即座に再取得して、表示を追いつかせる。</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-200">完了済みジョブを削除</dt>
                    <dd className="mt-1">完了・キャンセル・エラーのジョブをまとめて削除してリストを整理する。</dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={jobSubmittingKind !== null}
                    onClick={() => void handleEnqueueJob({ kind: 'fetch_new', days: 30, maxVideos: 20 })}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
                  >
                    {jobSubmittingKind === 'fetch_new' ? '登録中...' : '新規動画を取り込む'}
                  </button>
                  <button
                    type="button"
                    disabled={jobSubmittingKind !== null}
                    onClick={() => void handleEnqueueJob({ kind: 'reprocess' })}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {jobSubmittingKind === 'reprocess' ? '登録中...' : '字幕取得に失敗した動画を再試行'}
                  </button>
                  <button
                    type="button"
                    disabled={jobSubmittingKind !== null}
                    onClick={() => void handleEnqueueJob({ kind: 'weekly_magazine' })}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {jobSubmittingKind === 'weekly_magazine' ? '生成キューに登録中...' : '今週のマガジンを生成'}
                  </button>
                  <button
                    type="button"
                    disabled={jobsLoading}
                    onClick={() => void loadJobs(true)}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {jobsLoading ? '更新中...' : 'ジョブ一覧を更新'}
                  </button>
                  <button
                    type="button"
                    disabled={clearingJobs || jobsLoading}
                    onClick={() => void handleClearFinishedJobs()}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-red-700 hover:text-red-300 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {clearingJobs ? '削除中...' : '完了済みジョブを削除'}
                  </button>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-xs text-gray-500">
                  <span className="font-medium text-gray-400">ワーカー起動コマンド：</span>
                  <code className="ml-2 font-mono text-gray-300">ichiro-worker</code>
                  <span className="ml-3 text-gray-600">（キューのジョブを順番に処理します）</span>
                </div>

                {jobActionError && <p className="text-sm text-red-400">{jobActionError}</p>}
                {jobsError && <p className="text-sm text-red-400">{jobsError}</p>}

                {jobs.length === 0 && jobsLoading ? (
                  <p className="text-sm text-gray-500">ジョブ一覧を読み込み中...</p>
                ) : jobs.length === 0 ? (
                  <p className="text-sm text-gray-500">登録済みジョブはありません。</p>
                ) : (
                  <JobTable
                    jobs={jobs}
                    cancellingJobId={cancellingJobId}
                    deletingJobId={deletingJobId}
                    onCancel={handleCancelJob}
                    onDelete={handleDeleteJob}
                  />
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold">未レビュー動画</h2>
                  <p className="mt-1 text-sm text-gray-400">優先して確認したい配信を上にまとめています。</p>
                </div>
                <span className="text-sm text-gray-500">{dashboard.unreviewedStreams.length}件</span>
              </div>

              {dashboard.unreviewedStreams.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">未レビュー動画はありません。</p>
              ) : (
                <>
                  <div className="divide-y divide-gray-800">
                    {(showAllUnreviewed
                      ? dashboard.unreviewedStreams
                      : dashboard.unreviewedStreams.slice(0, UNREVIEWED_INITIAL_LIMIT)
                    ).map((stream) => (
                      <StreamRow
                        key={stream.id}
                        stream={stream}
                        toggling={togglingVideoIds.includes(stream.video_id)}
                        onToggleReviewed={handleToggleReviewed}
                      />
                    ))}
                  </div>
                  {dashboard.unreviewedStreams.length > UNREVIEWED_INITIAL_LIMIT && (
                    <div className="border-t border-gray-800 px-5 py-3">
                      <button
                        type="button"
                        onClick={() => setShowAllUnreviewed((prev) => !prev)}
                        className="text-sm text-gray-400 hover:text-white"
                      >
                        {showAllUnreviewed
                          ? '折りたたむ'
                          : `あと ${dashboard.unreviewedStreams.length - UNREVIEWED_INITIAL_LIMIT} 件を表示`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold">ブックマーク</h2>
                  <p className="mt-1 text-sm text-gray-400">プレイリスト作成用に仮置きした配信一覧</p>
                </div>
                <Link
                  href="/member"
                  className="text-sm text-gray-500 transition hover:text-gray-300"
                >
                  プレイリスト管理 →
                </Link>
              </div>

              {bookmarksLoading ? (
                <p className="px-5 py-6 text-sm text-gray-500">読み込み中...</p>
              ) : bookmarksError ? (
                <p className="px-5 py-6 text-sm text-red-400">{bookmarksError}</p>
              ) : bookmarks.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">ブックマークはありません。</p>
              ) : (
                <div className="divide-y divide-gray-800">
                  {bookmarks.map((stream) => (
                    <div key={stream.id} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{stream.title}</p>
                        <p className="mt-1 text-xs text-gray-400">
                          {new Date(stream.stream_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <Link
                        href={`/stream/${stream.video_id}`}
                        className="flex-shrink-0 text-sm text-gray-400 underline decoration-gray-700 underline-offset-4 hover:text-white"
                      >
                        ページを見る
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="border-b border-gray-800 px-5 py-4">
                <h2 className="text-base font-semibold">検索</h2>
                <p className="mt-1 text-sm text-gray-400">タイトル・動画IDに加えて、公開期間でも絞り込めます。</p>
              </div>

              <form onSubmit={handleSearch} className="space-y-4 px-5 py-4">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="タイトルまたは video_id で検索"
                  className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                />

                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-2">
                    <span className="block text-sm text-gray-300">開始日</span>
                    <input
                      type="date"
                      value={searchStartDate}
                      onChange={(event) => setSearchStartDate(event.target.value)}
                      className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="block text-sm text-gray-300">終了日</span>
                    <input
                      type="date"
                      value={searchEndDate}
                      onChange={(event) => setSearchEndDate(event.target.value)}
                      className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                    />
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={searching}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
                  >
                    {searching ? '検索中...' : '検索'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('')
                      setSearchStartDate('')
                      setSearchEndDate('')
                      setSearchResults([])
                      setSearchError('')
                      setHasSearched(false)
                    }}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                  >
                    クリア
                  </button>
                </div>
              </form>

              <div className="px-5 pb-5">
                {searching ? (
                  <p className="text-sm text-gray-500">検索中...</p>
                ) : searchError ? (
                  <p className="text-sm text-red-400">{searchError}</p>
                ) : !hasSearched ? (
                  <p className="text-sm text-gray-500">必要なときだけ検索を使ってください。</p>
                ) : searchResults.length === 0 ? (
                  <p className="text-sm text-gray-500">該当する動画が見つかりません。</p>
                ) : (
                  <div className="divide-y divide-gray-800 rounded-lg border border-gray-800">
                    {searchResults.map((stream) => (
                      <StreamRow
                        key={stream.id}
                        stream={stream}
                        toggling={togglingVideoIds.includes(stream.video_id)}
                        onToggleReviewed={handleToggleReviewed}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold">確認済み一覧</h2>
                  <p className="mt-1 text-sm text-gray-400">確認済みの動画を新しい順で20件ずつ表示します。</p>
                </div>
                <span className="text-sm text-gray-500">{allStreams.length}件表示中</span>
              </div>

              {allStreamsError && (
                <p className="px-5 pt-4 text-sm text-red-400">{allStreamsError}</p>
              )}

              {allStreams.length === 0 && allStreamsLoading ? (
                <p className="px-5 py-6 text-sm text-gray-500">動画を読み込み中...</p>
              ) : allStreams.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">動画がありません。</p>
              ) : (
                <>
                  <div className="divide-y divide-gray-800">
                    {allStreams.map((stream) => (
                      <StreamRow
                        key={stream.id}
                        stream={stream}
                        toggling={togglingVideoIds.includes(stream.video_id)}
                        onToggleReviewed={handleToggleReviewed}
                      />
                    ))}
                  </div>

                  <div className="border-t border-gray-800 px-5 py-4">
                    {allStreamsHasMore ? (
                      <button
                        type="button"
                        onClick={() => void handleLoadMore()}
                        disabled={allStreamsLoading}
                        className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                      >
                        {allStreamsLoading ? '読み込み中...' : 'さらに20件表示'}
                      </button>
                    ) : (
                      <p className="text-sm text-gray-500">すべて表示しました。</p>
                    )}
                  </div>
                </>
              )}
            </section>

            <section id="failed-streams" className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="border-b border-gray-800 px-5 py-4">
                <h2 className="text-base font-semibold">字幕取得失敗動画</h2>
                <p className="mt-1 text-sm text-gray-400">字幕を取得できず、自動処理が止まった配信一覧</p>
              </div>

              {dashboard.failedStreams.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">処理失敗動画はありません。</p>
              ) : (
                <div className="divide-y divide-gray-800">
                  {dashboard.failedStreams.map((stream) => (
                    <div key={stream.id} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{stream.title}</p>
                        <p className="mt-1 text-xs text-gray-400">{formatDate(stream.stream_date)}</p>
                      </div>
                      <Link
                        href={`/admin/stream/${stream.video_id}`}
                        className="text-sm text-gray-300 underline decoration-gray-700 underline-offset-4 hover:text-white"
                      >
                        編集
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="border-b border-gray-800 px-5 py-4">
                <h2 className="text-base font-semibold">検索ログ集計</h2>
                <p className="mt-1 text-sm text-gray-400">よく使われる検索語と、直近30日の検索数をまとめています。</p>
              </div>

              <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
                <div className="rounded-xl border border-gray-800 bg-gray-950/50">
                  <div className="border-b border-gray-800 px-4 py-3">
                    <h3 className="text-sm font-semibold text-white">上位検索ワード（Top 20）</h3>
                    <p className="mt-1 text-xs text-gray-500">同一クエリを集計した件数順</p>
                  </div>

                  {searchLogStatsError ? (
                    <p className="px-4 py-4 text-sm text-red-400">{searchLogStatsError}</p>
                  ) : initialSearchLogStats.topQueries.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-gray-500">検索ログはまだありません。</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-800 text-sm">
                        <thead className="bg-gray-950/40 text-left text-xs uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-4 py-3 font-medium">ワード</th>
                            <th className="px-4 py-3 text-right font-medium">件数</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {initialSearchLogStats.topQueries.map((item) => (
                            <tr key={item.query}>
                              <td className="px-4 py-3 text-gray-200">{item.query}</td>
                              <td className="px-4 py-3 text-right text-gray-300">{item.count.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-950/50">
                  <div className="border-b border-gray-800 px-4 py-3">
                    <h3 className="text-sm font-semibold text-white">日別検索件数（直近30日）</h3>
                    <p className="mt-1 text-xs text-gray-500">Asia/Tokyo 基準の日次件数</p>
                  </div>

                  {searchLogStatsError ? (
                    <p className="px-4 py-4 text-sm text-red-400">{searchLogStatsError}</p>
                  ) : initialSearchLogStats.dailyCounts.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-gray-500">直近30日の検索ログはありません。</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-800 text-sm">
                        <thead className="bg-gray-950/40 text-left text-xs uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-4 py-3 font-medium">日付</th>
                            <th className="px-4 py-3 text-right font-medium">件数</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {initialSearchLogStats.dailyCounts.map((item) => (
                            <tr key={item.date}>
                              <td className="px-4 py-3 text-gray-200">{formatSearchLogDate(item.date)}</td>
                              <td className="px-4 py-3 text-right text-gray-300">{item.count.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}
