'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { Highlight } from '@/lib/types'
import type {
  AdminChapter,
  AdminEditableStream,
  ScrutinyResult,
  UpdateAdminStreamInput,
} from '../../actions'
import {
  enqueueJob,
  fetchAdminChapters,
  fetchAdminStream,
  saveAdminChapters,
  scrutinizeStreamSummary,
  updateAdminStream,
} from '../../actions'

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
  highlights: Highlight[]
  isReviewed: boolean
}

type EditableChapter = {
  id: string
  start_sec: number | null
  end_sec: number | null
  title: string
  summary: string
}

const KNOWN_CORNER_NAMES = ['未知との遭遇', '深夜対談', 'ライブビデオ解説', 'ゲーム実況']
const HIGHLIGHT_REASONS: Highlight['reason'][] = ['笑い', '名言', '感動', '驚き', '神回']
const SCRUTINY_CATEGORY_LABELS: Record<string, string> = {
  song: '曲名',
  person: '人名',
  event: 'イベント',
  venue: '会場',
  other: 'その他',
}

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

function formatScrutinyCategory(category: string) {
  return SCRUTINY_CATEGORY_LABELS[category] ?? SCRUTINY_CATEGORY_LABELS.other
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
    highlights: stream.highlights ?? [],
    isReviewed: stream.is_reviewed,
  }
}

function createChapterId() {
  return globalThis.crypto?.randomUUID?.() ?? `chapter-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toEditableChapter(chapter: AdminChapter): EditableChapter {
  return {
    id: chapter.id,
    start_sec: chapter.start_sec,
    end_sec: chapter.end_sec,
    title: chapter.title,
    summary: chapter.summary ?? '',
  }
}

function createEmptyChapter(): EditableChapter {
  return {
    id: createChapterId(),
    start_sec: 0,
    end_sec: null,
    title: '',
    summary: '',
  }
}

function parseChapterNumber(value: string) {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
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
  const [stream, setStream] = useState<AdminEditableStream | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [chapters, setChapters] = useState<EditableChapter[]>([])
  const [customCornerName, setCustomCornerName] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [chapterError, setChapterError] = useState('')
  const [chapterSaveMessage, setChapterSaveMessage] = useState('')
  const [savingChapters, setSavingChapters] = useState(false)
  const [scrutinyResult, setScrutinyResult] = useState<ScrutinyResult | null>(null)
  const [scrutinyError, setScrutinyError] = useState('')
  const [scrutinizing, setScrutinizing] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessMessage, setReprocessMessage] = useState('')

  useEffect(() => {
    if (!reprocessMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setReprocessMessage('')
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [reprocessMessage])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setPageError('')
      setChapterError('')

      try {
        const [streamResult, chapterResult] = await Promise.allSettled([
          fetchAdminStream(videoId),
          fetchAdminChapters(videoId),
        ])

        if (!active) {
          return
        }

        if (streamResult.status === 'rejected') {
          setPageError('配信データの取得に失敗しました。')
          return
        }

        const data = streamResult.value

        if (!data) {
          setPageError('対象の配信が見つかりません。')
          return
        }

        setStream(data)
        setForm(toFormState(data))

        if (chapterResult.status === 'fulfilled') {
          setChapters(chapterResult.value.map(toEditableChapter))
        } else {
          setChapters([])
          setChapterError('チャプターデータの取得に失敗しました。')
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
  }, [videoId])

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

  function updateHighlight(index: number, nextValue: Highlight) {
    if (!form) return

    setForm({
      ...form,
      highlights: form.highlights.map((highlight, highlightIndex) =>
        highlightIndex === index ? nextValue : highlight
      ),
    })
  }

  function removeHighlight(index: number) {
    if (!form) return

    setForm({
      ...form,
      highlights: form.highlights.filter((_, highlightIndex) => highlightIndex !== index),
    })
  }

  function addHighlight() {
    if (!form) return

    setForm({
      ...form,
      highlights: [
        ...form.highlights,
        {
          start_sec: 0,
          quote: '',
          reason: '笑い',
        },
      ],
    })
  }

  function updateChapter(index: number, nextValue: EditableChapter) {
    setChapters((current) =>
      current.map((chapter, chapterIndex) => (chapterIndex === index ? nextValue : chapter))
    )
  }

  function removeChapter(index: number) {
    setChapters((current) => current.filter((_, chapterIndex) => chapterIndex !== index))
  }

  function addChapter() {
    setChapters((current) => [...current, createEmptyChapter()])
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
      highlights: form.highlights,
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

  async function handleSaveChapters() {
    setSavingChapters(true)
    setChapterError('')
    setChapterSaveMessage('')

    try {
      const normalizedChapters = chapters.map((chapter) => {
        if (chapter.start_sec === null) {
          throw new Error('開始秒を入力してください。')
        }

        if (chapter.title.trim().length === 0) {
          throw new Error('タイトルを入力してください。')
        }

        return {
          start_sec: chapter.start_sec,
          end_sec: chapter.end_sec,
          title: chapter.title.trim(),
          summary: chapter.summary.trim() || null,
        }
      })

      await saveAdminChapters({
        videoId,
        chapters: normalizedChapters,
      })

      const latestChapters = await fetchAdminChapters(videoId)
      setChapters(latestChapters.map(toEditableChapter))
      setChapterSaveMessage('チャプターを保存しました。')
    } catch (error) {
      setChapterError(error instanceof Error ? error.message : 'チャプターの保存に失敗しました。')
    } finally {
      setSavingChapters(false)
    }
  }

  async function handleScrutinizeSummary() {
    if (!stream) return

    setScrutinizing(true)
    setScrutinyResult(null)
    setScrutinyError('')

    try {
      const result = await scrutinizeStreamSummary(stream.video_id)
      setScrutinyResult(result)
    } catch {
      setScrutinyError('確認に失敗しました')
    } finally {
      setScrutinizing(false)
    }
  }

  async function handleReprocessSummary() {
    if (!stream) return

    setReprocessing(true)
    setReprocessMessage('')
    setPageError('')

    try {
      await enqueueJob({ kind: 'reprocess_single', videoId: stream.video_id })
      setReprocessMessage('再生成をキューに登録しました')
    } catch {
      setPageError('再生成のキュー登録に失敗しました。')
    } finally {
      setReprocessing(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="text-sm text-gray-400 transition hover:text-white">
            ← 一覧に戻る
          </Link>
          <div className="flex items-center gap-4">
            {stream && (
              <Link
                href={`/stream/${stream.video_id}`}
                className="text-sm text-gray-300 underline decoration-gray-700 underline-offset-4 hover:text-white"
              >
                公開ページ
              </Link>
            )}
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
                  rows={18}
                  className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-3 text-sm text-white outline-none transition focus:border-gray-600"
                />
              </label>

              {stream && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleScrutinizeSummary()}
                      disabled={scrutinizing}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
                    >
                      {scrutinizing ? '確認中...' : '固有名詞を確認'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReprocessSummary()}
                      disabled={reprocessing}
                      className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                    >
                      {reprocessing ? '登録中...' : '要約を再生成'}
                    </button>
                  </div>
                  {reprocessMessage && <p className="text-sm text-emerald-400">{reprocessMessage}</p>}

                  {(scrutinyResult || scrutinyError) && (
                    <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
                      <div className="space-y-3">
                        <div>
                          <h2 className="text-sm font-medium text-white">固有名詞の確認結果</h2>
                          <p className="mt-1 text-xs text-gray-500">要約文に含まれる名前を辞書と照合しています。</p>
                        </div>

                        {scrutinyError ? (
                          <p className="text-sm text-red-400">{scrutinyError}</p>
                        ) : scrutinyResult && scrutinyResult.entities.length > 0 ? (
                          <ul className="space-y-2">
                            {scrutinyResult.entities.map((entity) => (
                              <li
                                key={`${entity.status}:${entity.category}:${entity.name}`}
                                className={entity.status === 'found' ? 'text-sm text-emerald-400' : 'text-sm text-yellow-300'}
                              >
                                {entity.status === 'found' ? '✓ ' : '⚠ '}
                                {entity.name}
                                <span className="ml-1 text-xs text-gray-500">
                                  （{formatScrutinyCategory(entity.category)}）
                                </span>
                                {entity.status === 'not_found' && (
                                  <>
                                    <span>（未登録）</span>
                                    <Link
                                      href={`/admin/entity/new?name=${encodeURIComponent(entity.name)}`}
                                      className="ml-2 text-xs text-gray-400 underline hover:text-white"
                                    >
                                      登録
                                    </Link>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-gray-400">固有名詞は検出されませんでした</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

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

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm text-gray-300">チャプター</p>
                  <p className="text-xs text-gray-500">開始秒・終了秒・タイトル・要約を配信内容に合わせて調整します。</p>
                </div>

                <div className="space-y-3">
                  {chapters.map((chapter, index) => (
                    <div
                      key={chapter.id}
                      className="space-y-3 rounded-xl border border-gray-800 bg-gray-950 p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-[120px_120px_1fr_auto]">
                        <label className="block space-y-2">
                          <span className="text-sm text-gray-300">開始秒</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={chapter.start_sec ?? ''}
                            onChange={(event) =>
                              updateChapter(index, {
                                ...chapter,
                                start_sec: parseChapterNumber(event.target.value),
                              })
                            }
                            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                          />
                        </label>

                        <label className="block space-y-2">
                          <span className="text-sm text-gray-300">終了秒</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={chapter.end_sec ?? ''}
                            onChange={(event) =>
                              updateChapter(index, {
                                ...chapter,
                                end_sec: parseChapterNumber(event.target.value),
                              })
                            }
                            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                          />
                        </label>

                        <label className="block space-y-2">
                          <span className="text-sm text-gray-300">タイトル</span>
                          <input
                            value={chapter.title}
                            onChange={(event) =>
                              updateChapter(index, {
                                ...chapter,
                                title: event.target.value,
                              })
                            }
                            placeholder="例: オープニング雑談"
                            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600 truncate focus:overflow-x-auto"
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeChapter(index)}
                            className="rounded-lg border border-gray-800 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white"
                          >
                            削除
                          </button>
                        </div>
                      </div>

                      <label className="block space-y-2">
                        <span className="text-sm text-gray-300">要約</span>
                        <textarea
                          value={chapter.summary}
                          onChange={(event) =>
                            updateChapter(index, {
                              ...chapter,
                              summary: event.target.value,
                            })
                          }
                          rows={3}
                          placeholder="任意"
                          className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                        />
                      </label>
                    </div>
                  ))}
                </div>

                {(chapterError || chapterSaveMessage) && (
                  <div className="space-y-2">
                    {chapterError && <p className="text-sm text-red-400">{chapterError}</p>}
                    {chapterSaveMessage && <p className="text-sm text-emerald-400">{chapterSaveMessage}</p>}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={addChapter}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                  >
                    + 追加
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSaveChapters()}
                    disabled={savingChapters}
                    className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                  >
                    {savingChapters ? '保存中...' : 'チャプターを保存'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm text-gray-300">盛り上がりワード</p>
                  <p className="text-xs text-gray-500">印象に残る瞬間を、開始秒・発言・種別で調整します。</p>
                </div>

                <div className="space-y-3">
                  {form.highlights.map((highlight, index) => (
                    <div
                      key={index}
                      className="space-y-3 rounded-xl border border-gray-800 bg-gray-950 p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-[120px_1fr_140px_auto]">
                        <label className="block space-y-2">
                          <span className="text-sm text-gray-300">開始秒</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={highlight.start_sec}
                            onChange={(event) =>
                              updateHighlight(index, {
                                ...highlight,
                                start_sec: Number(event.target.value) || 0,
                              })
                            }
                            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                          />
                        </label>

                        <label className="block space-y-2">
                          <span className="text-sm text-gray-300">発言</span>
                          <input
                            value={highlight.quote}
                            onChange={(event) =>
                              updateHighlight(index, {
                                ...highlight,
                                quote: event.target.value,
                              })
                            }
                            placeholder="例: これはヤバい"
                            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600 truncate focus:overflow-x-auto"
                          />
                        </label>

                        <label className="block space-y-2">
                          <span className="text-sm text-gray-300">種別</span>
                          <select
                            value={highlight.reason}
                            onChange={(event) =>
                              updateHighlight(index, {
                                ...highlight,
                                reason: event.target.value as Highlight['reason'],
                              })
                            }
                            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                          >
                            {HIGHLIGHT_REASONS.map((reason) => (
                              <option key={reason} value={reason}>
                                {reason}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeHighlight(index)}
                            className="rounded-lg border border-gray-800 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addHighlight}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                >
                  + 追加
                </button>
              </div>

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
