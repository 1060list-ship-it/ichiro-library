'use client'

import { useState } from 'react'
import { searchSongs, previewSongMatches } from '../../actions'
import type { SongSearchResult } from '../../actions'
import type { SongMatchPreviewResult } from '@/lib/types'

export type NewSongFields = {
  title: string
  album: string
  discNo: string
  trackNo: string
  releasedAt: string
  notes: string
}

type Props = {
  songId: string | null
  onSongIdChange: (id: string | null) => void
  newSongFields: NewSongFields
  onNewSongFieldsChange: (fields: NewSongFields) => void
  matchNames: string[]
  previewConfirmed: boolean
  onPreviewConfirmedChange: (confirmed: boolean) => void
}

const fieldClass = 'w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600'

export default function SongPickerPanel({
  songId,
  onSongIdChange,
  newSongFields,
  onNewSongFieldsChange,
  matchNames,
  previewConfirmed,
  onPreviewConfirmedChange,
}: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [exactMatches, setExactMatches] = useState<SongSearchResult[]>([])
  const [partialMatches, setPartialMatches] = useState<SongSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [preview, setPreview] = useState<SongMatchPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const validAliasCount = matchNames.filter((n) => n.trim().length >= 3).length

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    try {
      const result = await searchSongs(query.trim())
      setExactMatches(result.exact)
      setPartialMatches(result.partial)
      setSearched(true)
      setCreatingNew(result.exact.length === 0)
    } finally {
      setSearching(false)
    }
  }

  async function handlePreview() {
    setPreviewing(true)
    setPreviewError('')
    try {
      const result = await previewSongMatches(matchNames)
      setPreview(result)
      onPreviewConfirmedChange(false)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'プレビューに失敗しました。')
    } finally {
      setPreviewing(false)
    }
  }

  const selectedSong = [...exactMatches, ...partialMatches].find((s) => s.id === songId)
  const needsConfirmation = preview !== null && (preview.total === 0 || preview.total > 20)

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold">紐づける楽曲</h2>
        <p className="mt-1 text-xs text-gray-500">既存の楽曲を検索するか、見つからなければ新規作成してください。</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        {songId && selectedSong ? (
          <div className="flex items-center justify-between rounded-lg border border-indigo-800 bg-indigo-950/30 px-3 py-2">
            <div>
              <p className="text-sm text-white">{selectedSong.title}</p>
              <p className="text-xs text-gray-500">{selectedSong.album ?? '(アルバム不明)'}</p>
            </div>
            <button type="button" onClick={() => onSongIdChange(null)} className="text-xs text-gray-400 hover:text-white transition-colors">
              選び直す
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                className={fieldClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch() } }}
                placeholder="楽曲タイトルで検索"
              />
              <button
                type="button"
                onClick={() => void handleSearch()}
                disabled={searching || !query.trim()}
                className="flex-shrink-0 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 disabled:opacity-40"
              >
                {searching ? '検索中…' : '検索'}
              </button>
            </div>

            {searched && exactMatches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">完全一致候補（選択するか、下から別の曲として新規作成してください）</p>
                {exactMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSongIdChange(s.id)}
                    className="w-full text-left rounded-lg border border-gray-800 px-3 py-2 text-sm text-gray-200 hover:border-gray-600"
                  >
                    {s.title}（{s.album ?? '不明'}）
                  </button>
                ))}
              </div>
            )}

            {searched && partialMatches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">部分一致候補</p>
                {partialMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSongIdChange(s.id)}
                    className="w-full text-left rounded-lg border border-gray-800 px-3 py-2 text-sm text-gray-200 hover:border-gray-600"
                  >
                    {s.title}（{s.album ?? '不明'}）
                  </button>
                ))}
              </div>
            )}

            {searched && exactMatches.length > 0 && !creatingNew && (
              <button
                type="button"
                onClick={() => setCreatingNew(true)}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                別の曲として新規作成する
              </button>
            )}

            {(!searched || creatingNew) && (
              <div className="space-y-3 border-t border-gray-800 pt-3">
                <p className="text-xs text-gray-500">新規楽曲として登録</p>
                <input
                  className={fieldClass}
                  value={newSongFields.title}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, title: e.target.value })}
                  placeholder="曲名 *"
                />
                <input
                  className={fieldClass}
                  value={newSongFields.album}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, album: e.target.value })}
                  placeholder="アルバム/シングル名"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    className={fieldClass}
                    value={newSongFields.discNo}
                    onChange={(e) => onNewSongFieldsChange({ ...newSongFields, discNo: e.target.value })}
                    placeholder="disc番号"
                  />
                  <input
                    type="number"
                    className={fieldClass}
                    value={newSongFields.trackNo}
                    onChange={(e) => onNewSongFieldsChange({ ...newSongFields, trackNo: e.target.value })}
                    placeholder="track番号"
                  />
                </div>
                <input
                  type="date"
                  className={fieldClass}
                  value={newSongFields.releasedAt}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, releasedAt: e.target.value })}
                />
                <textarea
                  className={`${fieldClass} min-h-[60px] resize-y`}
                  value={newSongFields.notes}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, notes: e.target.value })}
                  placeholder="メモ"
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        <h3 className="text-sm font-semibold">マッチプレビュー（保存前必須）</h3>
        <p className="text-xs text-gray-500">別名キーワードが配信本文にどれだけヒットするか、保存前に必ず確認してください。</p>
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={previewing || validAliasCount === 0}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 disabled:opacity-40"
        >
          {previewing ? '確認中…' : 'マッチをプレビュー'}
        </button>
        {previewError && <p className="text-xs text-red-400">{previewError}</p>}
        {preview && (
          <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-950 p-3">
            <p className="text-sm text-white">ヒット件数: {preview.total}件</p>
            {preview.top.length > 0 && (
              <ul className="space-y-1">
                {preview.top.map((s) => (
                  <li key={s.stream_id} className="text-xs text-gray-400">
                    {s.title}（{s.stream_date}）
                  </li>
                ))}
              </ul>
            )}
            {needsConfirmation && (
              <label className="flex items-center gap-2 text-xs text-amber-400">
                <input
                  type="checkbox"
                  checked={previewConfirmed}
                  onChange={(e) => onPreviewConfirmedChange(e.target.checked)}
                />
                {preview.total === 0
                  ? 'ヒットが0件ですが、今後の配信のために先行登録します'
                  : '一般的な語句の可能性があります。誤リンクがないか確認しました'}
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
