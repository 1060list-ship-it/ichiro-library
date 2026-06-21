'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useRef } from 'react'
import type { AdminEntity, AdminEntityStream } from '../../actions'
import { deleteAdminEntity, upsertAdminEntity } from '../../actions'
import { suggestEntityFields, type SuggestEntityResult } from '@/app/admin/actions'

const CATEGORIES = [
  { value: 'family',    label: '家族・地元' },
  { value: 'celebrity', label: '交友・影響元' },
  { value: 'remixer',   label: 'リミキサー' },
  { value: 'team',      label: 'チーム' },
  { value: 'craftsman', label: '職人' },
  { value: 'product',   label: 'コラボ製品' },
  { value: 'project',   label: 'プロジェクト' },
]

type Props = {
  entity: AdminEntity | null
  streams: AdminEntityStream[]
  prefillName?: string
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function EntityEditorClient({ entity, streams, prefillName }: Props) {
  const router = useRouter()
  const aliasInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(entity?.name ?? prefillName ?? '')
  const [slug, setSlug] = useState(entity?.slug ?? '')
  const [category, setCategory] = useState(entity?.category ?? 'celebrity')
  const [role, setRole] = useState(entity?.role ?? '')
  const [description, setDescription] = useState(entity?.description ?? '')
  const [matchNames, setMatchNames] = useState<string[]>(entity?.match_names ?? [])
  const [aliasInput, setAliasInput] = useState('')
  const [relatedWork, setRelatedWork] = useState(entity?.related_work ?? '')
  const [externalUrl, setExternalUrl] = useState(entity?.external_url ?? '')
  const [sortOrder, setSortOrder] = useState(entity?.sort_order?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')

  function addAlias() {
    const v = aliasInput.trim()
    if (v && !matchNames.includes(v)) {
      setMatchNames(prev => [...prev, v])
    }
    setAliasInput('')
    aliasInputRef.current?.focus()
  }

  function removeAlias(alias: string) {
    setMatchNames(prev => prev.filter(n => n !== alias))
  }

  async function handleSuggest() {
    if (!name.trim()) return
    setSuggesting(true)
    try {
      const result: SuggestEntityResult = await suggestEntityFields(name.trim())
      if (result.slug) setSlug(result.slug)
      if (result.category) setCategory(result.category)
      if (result.role) setRole(result.role)
      if (result.description) setDescription(result.description)
      if (result.matchNames.length > 0) setMatchNames(result.matchNames)
      if (result.relatedWork) setRelatedWork(result.relatedWork)
      if (result.externalUrl) setExternalUrl(result.externalUrl)
    } catch {
      // silent fail
    } finally {
      setSuggesting(false)
    }
  }

  async function handleSave() {
    if (!name.trim() || !slug.trim()) {
      setError('名前とスラッグは必須です。')
      return
    }
    setSaving(true)
    setError('')
    try {
      await upsertAdminEntity({
        id: entity?.id,
        name, slug, category, role, description,
        matchNames, relatedWork, externalUrl, sortOrder,
      })
      router.push('/admin/entity')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!entity?.id) return
    if (!window.confirm(`「${entity.name}」を削除しますか？この操作は元に戻せません。`)) return
    setDeleting(true)
    setError('')
    try {
      await deleteAdminEntity(entity.id)
      router.push('/admin/entity')
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました。')
      setDeleting(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600'
  const labelClass = 'block space-y-2'
  const labelTextClass = 'text-sm text-gray-300'

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin/entity" className="text-sm text-gray-400 hover:text-white transition-colors">
              ← 一覧へ
            </Link>
            <h1 className="text-lg font-semibold">
              {entity ? entity.name : '新規エンティティ'}
            </h1>
          </div>
          {entity && (
            <Link
              href={`/entity/${entity.slug}`}
              target="_blank"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              公開ページ →
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold">基本情報</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            <label className={labelClass}>
              <span className={labelTextClass}>名前 *</span>
              <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="浜田省吾" />
            </label>
            <button
              type="button"
              onClick={handleSuggest}
              disabled={suggesting || !name.trim()}
              className="mt-1 text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-40"
            >
              {suggesting ? 'AI 調査中…' : 'AI で自動入力'}
            </button>
            <label className={labelClass}>
              <span className={labelTextClass}>スラッグ *</span>
              <input className={inputClass} value={slug} onChange={e => setSlug(e.target.value)} placeholder="hamada-shogo" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>カテゴリ</span>
              <select
                className={inputClass}
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>役割・肩書き</span>
              <input className={inputClass} value={role} onChange={e => setRole(e.target.value)} placeholder="ミュージシャン" />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>説明</span>
              <textarea
                className={`${inputClass} min-h-[120px] resize-y`}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold">別名・検索キーワード</h2>
            <p className="mt-1 text-xs text-gray-500">表記ゆれを登録しておくと検索でヒットするようになります。</p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {matchNames.map(alias => (
                <span key={alias} className="flex items-center gap-1 bg-gray-800 text-gray-300 text-xs px-2.5 py-1 rounded-full">
                  {alias}
                  <button
                    type="button"
                    onClick={() => removeAlias(alias)}
                    className="text-gray-500 hover:text-white transition-colors ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
              {matchNames.length === 0 && (
                <p className="text-xs text-gray-600">別名なし</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                ref={aliasInputRef}
                className="flex-1 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600"
                value={aliasInput}
                onChange={e => setAliasInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAlias() } }}
                placeholder="別名を入力してEnter"
              />
              <button
                type="button"
                onClick={addAlias}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
              >
                追加
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold">補足情報</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            <label className={labelClass}>
              <span className={labelTextClass}>関連作品</span>
              <textarea
                className={`${inputClass} min-h-[80px] resize-y`}
                value={relatedWork}
                onChange={e => setRelatedWork(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>外部リンク URL</span>
              <input className={inputClass} value={externalUrl} onChange={e => setExternalUrl(e.target.value)} placeholder="https://..." />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>表示順</span>
              <input
                type="number"
                className={inputClass}
                value={sortOrder}
                onChange={e => setSortOrder(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
        </div>

        {streams.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">関連配信</h2>
              <p className="mt-1 text-xs text-gray-500">stream_entities テーブルで紐付けられた配信（読み取り専用）</p>
            </div>
            <div className="divide-y divide-gray-800">
              {streams.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(s.stream_date)}</p>
                  </div>
                  <Link
                    href={`/stream/${s.video_id}`}
                    target="_blank"
                    className="flex-shrink-0 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    開く →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {entity?.id ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 transition hover:border-red-700 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? '削除中...' : '削除'}
            </button>
          ) : <div />}
          <div className="flex gap-3">
            <Link
              href="/admin/entity"
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
            >
              キャンセル
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
