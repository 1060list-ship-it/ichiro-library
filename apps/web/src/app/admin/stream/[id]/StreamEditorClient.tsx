'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { AdminEditableStream, UpdateAdminStreamInput } from '../../actions'
import { fetchAdminStream, updateAdminStream } from '../../actions'
import { useAdminAuth } from '../../useAdminAuth'

type Props = {
  videoId: string
}

type FormState = {
  summary: string
  tags: string
  cornerNames: string[]
  guests: string
  songs: string
  hasLiveSinging: boolean
  hasLiveViewing: boolean
  supportsLiveViewing: boolean
  talkTopics: string
  isReviewed: boolean
}

const KNOWN_CORNER_NAMES = ['未知との遭遇', '深夜対談', 'ライブビデオ解説', 'ゲーム実況']

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatStatus(status: string) {
  if (status === 'transcript_failed') return '字幕取得失敗'
  if (status === 'completed') return '処理完了'
  if (status === 'pending') return '処理待ち'
  return status
}

function toCsv(values: string[] | null) {
  return values?.join(', ') ?? ''
}

function toFormState(stream: AdminEditableStream): FormState {
  return {
    summary: stream.summary ?? '',
    tags: toCsv(stream.tags),
    cornerNames: stream.corner_names ?? [],
    guests: toCsv(stream.guests),
    songs: toCsv(stream.songs),
    hasLiveSinging: Boolean(stream.has_live_singing),
    hasLiveViewing: Boolean(stream.has_live_viewing),
    supportsLiveViewing: stream.supportsLiveViewing,
    talkTopics: toCsv(stream.talk_topics),
    isReviewed: stream.is_reviewed,
  }
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  description,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  description?: string
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-gray-300">{label}</span>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
      />
    </label>
  )
}

export default function StreamEditorClient({ videoId }: Props) {
  const router = useRouter()
  const { ready, authenticated, submitting, error, login } = useAdminAuth()
  const [password, setPassword] = useState('')
  const [stream, setStream] = useState<AdminEditableStream | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [customCornerName, setCustomCornerName] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!ready || !authenticated) {
      return
    }

    let active = true

    async function load() {
      setLoading(true)
      setPageError('')

      try {
        const data = await fetchAdminStream(videoId)

        if (!active) return

        if (!data) {
          setPageError('対象の配信が見つかりません。')
          return
        }

        setStream(data)
        setForm(toFormState(data))
      } catch {
        if (active) {
          setPageError('配信データの取得に失敗しました。')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      active = false
    }
  }, [ready, authenticated, videoId])

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const ok = await login(password)
    if (ok) {
      setPassword('')
    }
  }

  function toggleCornerName(cornerName: string) {
    if (!form) return

    const exists = form.cornerNames.includes(cornerName)
    const nextCornerNames = exists
      ? form.cornerNames.filter((value) => value !== cornerName)
      : [...form.cornerNames, cornerName]

    setForm({
      ...form,
      cornerNames: nextCornerNames,
      hasLiveViewing: nextCornerNames.includes('ライブビデオ解説') ? true : form.hasLiveViewing,
    })
  }

  function addCustomCornerName() {
    if (!form) return

    const value = customCornerName.trim()
    if (!value) return

    if (!form.cornerNames.includes(value)) {
      const nextCornerNames = [...form.cornerNames, value]
      setForm({
        ...form,
        cornerNames: nextCornerNames,
        hasLiveViewing: nextCornerNames.includes('ライブビデオ解説') ? true : form.hasLiveViewing,
      })
    }

    setCustomCornerName('')
  }

  async function handleSave(returnToList = false) {
    if (!form) return

    setSaving(true)
    setSaveMessage('')
    setPageError('')

    const payload: UpdateAdminStreamInput = {
      videoId,
      summary: form.summary,
      tags: form.tags,
      cornerNames: form.cornerNames.join(', '),
      guests: form.guests,
      songs: form.songs,
      hasLiveSinging: form.hasLiveSinging,
      hasLiveViewing: form.supportsLiveViewing ? form.hasLiveViewing : false,
      talkTopics: form.talkTopics,
      isReviewed: form.isReviewed,
    }

    try {
      const updated = await updateAdminStream(payload)
      setStream(updated)
      setForm(toFormState(updated))
      if (returnToList) {
        router.push('/admin')
        router.refresh()
        return
      }
      setSaveMessage('保存しました。')
    } catch {
      setPageError('保存に失敗しました。')
    } finally {
      setSaving(false)
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
          <h1 className="text-lg font-semibold">動画編集</h1>
          <p className="mt-2 text-sm text-gray-400">編集には管理者パスワードが必要です。</p>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="stream-admin-password" className="block text-sm text-gray-300">
                パスワード
              </label>
              <input
                id="stream-admin-password"
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
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="text-sm text-gray-400 transition hover:text-white">
            ← 一覧に戻る
          </Link>
          {stream?.youtube_url && (
            <a
              href={stream.youtube_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-300 underline decoration-gray-700 underline-offset-4 hover:text-white"
            >
              YouTubeで開く
            </a>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {loading ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <p className="text-sm text-gray-500">配信データを読み込み中...</p>
          </div>
        ) : pageError && !stream ? (
          <div className="rounded-xl border border-red-900 bg-red-950/30 p-6">
            <p className="text-sm text-red-300">{pageError}</p>
          </div>
        ) : stream && form ? (
          <div className="space-y-6">
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-2">
                  <p className="text-sm text-gray-400">{formatDate(stream.stream_date)}</p>
                  <h1 className="text-xl font-semibold leading-snug">{stream.title}</h1>
                  <div className="flex gap-3 text-xs text-gray-400">
                    <span>{formatStatus(stream.status)}</span>
                    <span>{stream.video_id}</span>
                    <span>{form.isReviewed ? '確認済み' : '未レビュー'}</span>
                  </div>
                </div>

                {stream.thumbnail_url && (
                  <div className="w-56 overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={stream.thumbnail_url} alt={stream.title} className="h-full w-full object-cover" />
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-3">
              <div>
                <h2 className="text-base font-semibold">動画プレビュー</h2>
                <p className="mt-1 text-sm text-gray-400">内容を確認しながら編集できます。</p>
              </div>

              <div className="aspect-video w-full overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
                <iframe
                  src={`https://www.youtube.com/embed/${stream.video_id}`}
                  title={stream.title}
                  className="h-full w-full"
                  allowFullScreen
                />
              </div>
            </section>

            <section className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-5">
              <label className="block space-y-2">
                <span className="text-sm text-gray-300">配信の要約</span>
                <p className="text-xs text-gray-500">配信内容を短く分かりやすくまとめます。</p>
                <textarea
                  value={form.summary}
                  onChange={(event) => setForm({ ...form, summary: event.target.value })}
                  rows={8}
                  className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-3 text-sm text-white outline-none transition focus:border-gray-600"
                />
              </label>

              <TextField
                label="タグ"
                value={form.tags}
                onChange={(value) => setForm({ ...form, tags: value })}
                description="検索や分類に使うキーワードをカンマ区切りで入力します。"
                placeholder="例: 雑談, 音楽, 深夜"
              />

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm text-gray-300">コーナー名</p>
                  <p className="text-xs text-gray-500">よく使うコーナーはチェックで選び、無いものだけ追加します。</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {KNOWN_CORNER_NAMES.map((cornerName) => {
                    const checked = form.cornerNames.includes(cornerName)
                    return (
                      <label
                        key={cornerName}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-sm transition ${
                          checked
                            ? 'border-white bg-white text-gray-950'
                            : 'border-gray-800 bg-gray-950 text-gray-300 hover:border-gray-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCornerName(cornerName)}
                          className="h-4 w-4 rounded border-gray-500"
                        />
                        <span>{cornerName}</span>
                      </label>
                    )
                  })}
                </div>

                <div className="flex gap-2">
                  <input
                    value={customCornerName}
                    onChange={(event) => setCustomCornerName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addCustomCornerName()
                      }
                    }}
                    placeholder="コーナー名を追加"
                    className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                  />
                  <button
                    type="button"
                    onClick={addCustomCornerName}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                  >
                    追加
                  </button>
                </div>

                {form.cornerNames.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.cornerNames.map((cornerName) => (
                      <button
                        key={cornerName}
                        type="button"
                        onClick={() => toggleCornerName(cornerName)}
                        className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-200 transition hover:border-gray-500 hover:text-white"
                      >
                        {cornerName} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <TextField
                label="ゲスト"
                value={form.guests}
                onChange={(value) => setForm({ ...form, guests: value })}
                description="出演したゲスト名をカンマ区切りで入力します。"
                placeholder="例: 岩寺基晴"
              />

              <TextField
                label="歌った曲・扱った曲"
                value={form.songs}
                onChange={(value) => setForm({ ...form, songs: value })}
                description="配信内で歌った曲や取り上げた曲名をカンマ区切りで入力します。"
                placeholder="例: 新宝島, アイデンティティ"
              />

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={form.hasLiveSinging}
                    onChange={(event) => setForm({ ...form, hasLiveSinging: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-white focus:ring-0"
                  />
                  <div>
                    <p className="text-sm text-gray-300">歌唱あり</p>
                    <p className="text-xs text-gray-500">配信内で実際に歌っている場面がある場合にオンにします。</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={form.hasLiveViewing}
                    disabled={!form.supportsLiveViewing}
                    onChange={(event) => setForm({ ...form, hasLiveViewing: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-white focus:ring-0"
                  />
                  <div>
                    <p className="text-sm text-gray-300">ライブ鑑賞あり</p>
                    <p className="text-xs text-gray-500">
                      {form.supportsLiveViewing
                        ? '過去のライブ映像を見ながら話している配信ならオンにします。'
                        : 'DB項目未適用のため、いまは保存できません。migration 適用後に使えます。'}
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
                <div>
                  <p className="text-sm text-gray-300">確認済み</p>
                  <p className="mt-1 text-xs text-gray-500">レビュー完了ならオンにして保存します。</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isReviewed}
                  onClick={() => setForm({ ...form, isReviewed: !form.isReviewed })}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                    form.isReviewed ? 'bg-white' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-gray-950 transition ${
                      form.isReviewed ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <TextField
                label="トークテーマ"
                value={form.talkTopics}
                onChange={(value) => setForm({ ...form, talkTopics: value })}
                description="配信で話していた主なテーマをカンマ区切りで入力します。"
                placeholder="例: ツアー制作, 機材, 作曲"
              />

              {(pageError || saveMessage) && (
                <div className="space-y-2">
                  {pageError && <p className="text-sm text-red-400">{pageError}</p>}
                  {saveMessage && <p className="text-sm text-emerald-400">{saveMessage}</p>}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
                >
                  {saving ? '保存中...' : '保存'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleSave(true)}
                  disabled={saving}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                >
                  {saving ? '保存中...' : '保存して一覧に戻る'}
                </button>
              </div>

              <div>
                <Link href="/admin" className="text-sm text-gray-400 transition hover:text-white">
                  一覧に戻る
                </Link>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  )
}
