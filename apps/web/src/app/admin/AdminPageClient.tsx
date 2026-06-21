'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { AdminDashboardData, AdminListStream, EnqueueJobInput, PipelineJob } from './actions'
import {
  cancelPipelineJob,
  clearFinishedJobs,
  enqueueJob,
  fetchAdminDashboard,
  fetchAdminStreamsPage,
  fetchRecentJobs,
  searchAdminStreams,
  setAdminStreamReviewed,
} from './actions'
import { useAdminAuth } from './useAdminAuth'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric',
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
        <p className="truncate text-sm font-medium text-white">{stream.title}</p>
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value.toLocaleString()}</p>
    </div>
  )
}

function JobTable({
  jobs,
  cancellingJobId,
  onCancel,
}: {
  jobs: PipelineJob[]
  cancellingJobId: string | null
  onCancel: (jobId: string) => void
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
                {job.status === 'pending' ? (
                  <button
                    type="button"
                    disabled={cancellingJobId === job.id}
                    onClick={() => onCancel(job.id)}
                    className="rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {cancellingJobId === job.id ? '取り消し中...' : '取り消し'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-600">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminPageClient() {
  const { ready, authenticated, submitting, error, login, logout } = useAdminAuth()
  const [password, setPassword] = useState('')
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
  const [clearingJobs, setClearingJobs] = useState(false)

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

  useEffect(() => {
    if (!ready || !authenticated) {
      return
    }

    queueMicrotask(() => {
      void loadDashboardData()
      void loadInitialStreams()
      void loadJobs()
    })
  }, [authenticated, loadDashboardData, loadInitialStreams, loadJobs, ready])

  useEffect(() => {
    if (!ready || !authenticated) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadJobs()
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [authenticated, loadJobs, ready])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const ok = await login(password)
    if (ok) {
      setPassword('')
    }
  }

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

  if (!ready) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-sm text-gray-500">認証状態を確認しています...</p>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h1 className="text-lg font-semibold">管理画面</h1>
          <p className="mt-2 text-sm text-gray-400">閲覧・編集には管理者パスワードが必要です。</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="admin-password" className="block text-sm text-gray-300">
                パスワード
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                autoComplete="current-password"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting || password.length === 0}
              className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
            >
              {submitting ? '認証中...' : 'ログイン'}
            </button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">ichiro library 管理画面</h1>
            <p className="mt-1 text-sm text-gray-400">配信メタデータの確認と手動修正</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
          >
            ログアウト
          </button>
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
              <StatCard label="字幕取得失敗数" value={dashboard.summary.transcriptFailedCount} />
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
                    onCancel={handleCancelJob}
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
                <div className="divide-y divide-gray-800">
                  {dashboard.unreviewedStreams.map((stream) => (
                    <StreamRow
                      key={stream.id}
                      stream={stream}
                      toggling={togglingVideoIds.includes(stream.video_id)}
                      onToggleReviewed={handleToggleReviewed}
                    />
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

            <section className="rounded-xl border border-gray-800 bg-gray-900">
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
          </>
        ) : null}
      </div>
    </main>
  )
}
