'use client'

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Entity, EntityWordRequest, Playlist, PlaylistStream, Stream, UserRole } from '@/lib/types'
import {
  addStreamToPlaylist,
  approveEntityWordRequest,
  createPlaylist,
  deletePlaylist,
  fetchBookmarkedStreams,
  rejectEntityWordRequest,
  removeStreamFromPlaylist,
  reorderPlaylistStream,
  submitEntityWordRequest,
  toggleBookmark,
  updatePlaylist,
} from './actions'

type CurrentUser = {
  id: string
  email: string
}

type MemberStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'tags' | 'corner_names'>
type MemberPlaylistItem = Pick<PlaylistStream, 'id' | 'playlist_id' | 'stream_id' | 'position' | 'added_at'> & {
  stream: MemberStream
}
type MemberPlaylist = Pick<Playlist, 'id' | 'title' | 'description' | 'created_at' | 'updated_at'> & {
  items: MemberPlaylistItem[]
}
type MemberEntity = Pick<Entity, 'id' | 'name'>
type MemberEntityRequest = Pick<
  EntityWordRequest,
  'id' | 'entity_id' | 'word' | 'status' | 'requested_by' | 'reviewed_by' | 'requested_at' | 'reviewed_at'
>
type EditablePlaylist = MemberPlaylist & {
  savedTitle: string
  savedDescription: string
}
type SaveState = {
  status: 'saved' | 'saving' | 'error'
  message: string
  busy: boolean
  itemId: string | null
}
type TabKey = 'playlists' | 'entities'
type Props = {
  currentUser: CurrentUser
  role: UserRole
  initialPlaylists: MemberPlaylist[]
  initialEntities: MemberEntity[]
  initialRequests: MemberEntityRequest[]
}

const DEFAULT_SAVE_MESSAGE = '保存済み'
let optimisticItemCounter = 0

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toEditablePlaylists(playlists: MemberPlaylist[]) {
  return playlists.map((playlist) => ({
    ...playlist,
    savedTitle: playlist.title,
    savedDescription: playlist.description ?? '',
  }))
}

function buildSaveStateMap(playlists: MemberPlaylist[]) {
  return Object.fromEntries(playlists.map((playlist) => ([
    playlist.id,
    {
      status: 'saved',
      message: DEFAULT_SAVE_MESSAGE,
      busy: false,
      itemId: null,
    } satisfies SaveState,
  ])))
}

function nextOptimisticPlaylistItemId(streamId: string) {
  optimisticItemCounter += 1
  return `temp-${streamId}-${optimisticItemCounter}`
}

function getDefaultSaveState(): SaveState {
  return {
    status: 'saved',
    message: DEFAULT_SAVE_MESSAGE,
    busy: false,
    itemId: null,
  }
}

function isConflictError(error: unknown) {
  return error instanceof Error && error.message.includes('409 Conflict')
}

function isAuthError(error: unknown) {
  return error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')
}

function getErrorMessage(error: unknown) {
  if (isAuthError(error)) {
    return 'ログインし直してください'
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return '処理に失敗しました'
}

function toPositionString(value: number) {
  return value.toFixed(8)
}

function computeTargetPosition(items: MemberPlaylistItem[], movingItemId: string, nextIndex: number) {
  const remaining = items.filter((item) => item.id !== movingItemId)
  const previousItem = remaining[nextIndex - 1] ?? null
  const nextItem = remaining[nextIndex] ?? null

  if (!previousItem && !nextItem) {
    return 10000
  }

  if (!previousItem && nextItem) {
    return Math.max(Number(nextItem.position) / 2, 0.00000001)
  }

  if (previousItem && !nextItem) {
    return Number(previousItem.position) + 10000
  }

  return (Number(previousItem?.position) + Number(nextItem?.position)) / 2
}

function saveToneClass(status: SaveState['status']) {
  if (status === 'saving') {
    return 'border-amber-800/80 bg-amber-500/10 text-amber-200'
  }

  if (status === 'error') {
    return 'border-red-900/80 bg-red-500/10 text-red-200'
  }

  return 'border-emerald-900/80 bg-emerald-500/10 text-emerald-200'
}

function saveToneText(status: SaveState['status'], message: string) {
  if (status === 'saving') {
    return `● ${message}`
  }

  if (status === 'error') {
    return `⚠ ${message}`
  }

  return `✓ ${message}`
}

function TagPill({ children, tone = 'gray' }: { children: string; tone?: 'gray' | 'indigo' }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        tone === 'indigo'
          ? 'bg-indigo-950/80 text-indigo-200'
          : 'bg-gray-800 text-gray-300'
      }`}
    >
      {children}
    </span>
  )
}

function SaveStatusBar({ state }: { state: SaveState }) {
  return (
    <div className="sticky top-2 z-10">
      <div className={`rounded-2xl border px-4 py-3 text-sm ${saveToneClass(state.status)}`}>
        {saveToneText(state.status, state.message)}
      </div>
    </div>
  )
}

function SortablePlaylistItem({
  item,
  index,
  busy,
  rowMessage,
  onRemove,
}: {
  item: MemberPlaylistItem
  index: number
  busy: boolean
  rowMessage: string | null
  onRemove: (item: MemberPlaylistItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
      : undefined,
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border px-4 py-4 transition ${
        isDragging
          ? 'border-indigo-500 bg-indigo-500/10 shadow-2xl shadow-indigo-950/40'
          : 'border-gray-800 bg-gray-950/70'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={busy}
          className="mt-1 rounded-xl border border-gray-700 px-2 py-1 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`${item.stream.title} をドラッグして並び替え`}
          {...attributes}
          {...listeners}
        >
          ≡
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.22em] text-gray-500">
                #{index + 1} / {item.stream.video_id}
              </p>
              <h4 className="mt-1 text-sm font-medium leading-6 text-white">
                {item.stream.title}
              </h4>
              <p className="mt-1 text-xs text-gray-500">
                {formatDate(item.stream.stream_date)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {rowMessage ? (
                <span className="text-xs text-amber-300">
                  {rowMessage}
                </span>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(item)}
                className="rounded-xl border border-red-900/70 px-3 py-2 text-xs font-medium text-red-200 transition hover:border-red-700 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                削除
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(item.stream.corner_names ?? []).slice(0, 3).map((cornerName) => (
              <TagPill key={cornerName} tone="indigo">
                {cornerName}
              </TagPill>
            ))}
            {(item.stream.tags ?? []).slice(0, 4).map((tag) => (
              <TagPill key={tag}>{tag}</TagPill>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function MobilePlaylistItem({
  item,
  index,
  total,
  busy,
  rowMessage,
  onMove,
  onRemove,
}: {
  item: MemberPlaylistItem
  index: number
  total: number
  busy: boolean
  rowMessage: string | null
  onMove: (itemId: string, direction: -1 | 1) => void
  onRemove: (item: MemberPlaylistItem) => void
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-gray-500">
            #{index + 1} / {item.stream.video_id}
          </p>
          <h4 className="mt-1 text-sm font-medium leading-6 text-white">
            {item.stream.title}
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            {formatDate(item.stream.stream_date)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || index === 0}
            onClick={() => onMove(item.id, -1)}
            className="min-h-11 min-w-11 rounded-xl border border-gray-700 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="上へ移動"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={busy || index === total - 1}
            onClick={() => onMove(item.id, 1)}
            className="min-h-11 min-w-11 rounded-xl border border-gray-700 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="下へ移動"
          >
            ↓
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(item.stream.corner_names ?? []).slice(0, 3).map((cornerName) => (
          <TagPill key={cornerName} tone="indigo">
            {cornerName}
          </TagPill>
        ))}
        {(item.stream.tags ?? []).slice(0, 4).map((tag) => (
          <TagPill key={tag}>{tag}</TagPill>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-amber-300">
          {rowMessage ?? ''}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(item)}
          className="rounded-xl border border-red-900/70 px-3 py-2 text-xs font-medium text-red-200 transition hover:border-red-700 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          削除
        </button>
      </div>
    </div>
  )
}

export default function MemberPageClient({
  currentUser,
  role,
  initialPlaylists,
  initialEntities,
  initialRequests,
}: Props) {
  const router = useRouter()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const [activeTab, setActiveTab] = useState<TabKey>('playlists')
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(initialPlaylists[0]?.id ?? null)
  const [playlists, setPlaylists] = useState<EditablePlaylist[]>(() => toEditablePlaylists(initialPlaylists))
  const [entities, setEntities] = useState<MemberEntity[]>(initialEntities)
  const [requests, setRequests] = useState<MemberEntityRequest[]>(initialRequests)
  const [playlistStates, setPlaylistStates] = useState<Record<string, SaveState>>(() => buildSaveStateMap(initialPlaylists))
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createError, setCreateError] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MemberStream[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
  const [entityId, setEntityId] = useState(initialEntities[0]?.id ?? '')
  const [entityWord, setEntityWord] = useState('')
  const [entityError, setEntityError] = useState('')
  const [entityPending, setEntityPending] = useState(false)
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null)

  useEffect(() => {
    startTransition(() => {
      setPlaylists(toEditablePlaylists(initialPlaylists))
      setPlaylistStates(buildSaveStateMap(initialPlaylists))
    })
  }, [initialPlaylists])

  useEffect(() => {
    startTransition(() => {
      setEntities(initialEntities)
      setEntityId((current) => {
        if (current && initialEntities.some((entity) => entity.id === current)) {
          return current
        }

        return initialEntities[0]?.id ?? ''
      })
    })
  }, [initialEntities])

  useEffect(() => {
    startTransition(() => {
      setRequests(initialRequests)
    })
  }, [initialRequests])

  useEffect(() => {
    if (expandedPlaylistId && !playlists.some((playlist) => playlist.id === expandedPlaylistId)) {
      startTransition(() => {
        setExpandedPlaylistId(playlists[0]?.id ?? null)
      })
    }
  }, [expandedPlaylistId, playlists])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const media = window.matchMedia('(pointer: coarse)')
    const syncPointer = () => setIsCoarsePointer(media.matches)
    syncPointer()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncPointer)
      return () => media.removeEventListener('change', syncPointer)
    }

    media.addListener(syncPointer)
    return () => media.removeListener(syncPointer)
  }, [])

  const currentPlaylist = playlists.find((playlist) => playlist.id === expandedPlaylistId) ?? null
  const entityNameMap = new Map(entities.map((entity) => [entity.id, entity.name]))

  useEffect(() => {
    if (!currentPlaylist) {
      startTransition(() => {
        setSearchResults([])
        setSearchError('')
        setSearchPending(false)
      })
      return
    }

    let active = true
    const normalizedQuery = searchQuery.trim()

    if (!normalizedQuery && !bookmarkedOnly) {
      startTransition(() => {
        setSearchResults([])
        setSearchError('')
        setSearchPending(false)
      })
      return
    }

    startTransition(() => {
      setSearchPending(true)
      setSearchError('')
    })

    const timer = window.setTimeout(async () => {
      try {
        let nextResults: MemberStream[] = []

        if (bookmarkedOnly) {
          const bookmarkedStreams = await fetchBookmarkedStreams(
            normalizedQuery
              ? { query: normalizedQuery }
              : undefined,
          )

          nextResults = bookmarkedStreams.map((stream) => ({
            id: stream.id,
            video_id: stream.video_id,
            title: stream.title,
            stream_date: stream.stream_date,
            tags: stream.tags,
            corner_names: stream.corner_names,
          }))
        } else {
          const { data, error } = await supabase
            .from('streams')
            .select('id, video_id, title, stream_date, tags, corner_names')
            .in('status', ['public', 'unlisted'])
            .ilike('title', `%${normalizedQuery}%`)
            .order('stream_date', { ascending: false })
            .limit(12)

          if (error) {
            throw error
          }

          nextResults = (data ?? []) as unknown as MemberStream[]
        }

        if (!active) {
          return
        }

        const seen = new Set<string>()
        const deduped = nextResults.filter((stream) => {
          if (seen.has(stream.id)) {
            return false
          }
          seen.add(stream.id)
          return true
        })

        setSearchResults(deduped)
      } catch (error) {
        if (!active) {
          return
        }

        console.error(error)
        setSearchError(getErrorMessage(error))
      } finally {
        if (active) {
          setSearchPending(false)
        }
      }
    }, bookmarkedOnly ? 0 : 220)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [bookmarkedOnly, currentPlaylist, searchQuery])

  const setPlaylistState = (playlistId: string, nextState: Partial<SaveState>) => {
    setPlaylistStates((current) => ({
      ...current,
      [playlistId]: {
        ...(current[playlistId] ?? getDefaultSaveState()),
        ...nextState,
      },
    }))
  }

  const updatePlaylistState = (
    playlistId: string,
    updater: (playlist: EditablePlaylist) => EditablePlaylist,
  ) => {
    setPlaylists((current) => current.map((playlist) => (
      playlist.id === playlistId ? updater(playlist) : playlist
    )))
  }

  const syncLoginRedirect = (error: unknown) => {
    if (isAuthError(error)) {
      router.push('/login?return=/member')
    }
  }

  const refreshAfterConflict = (playlistId: string, message: string) => {
    setPlaylistState(playlistId, {
      status: 'error',
      message,
      busy: false,
      itemId: null,
    })
    router.refresh()
  }

  const handleCreatePlaylist = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const title = createTitle.trim()
    if (!title) {
      setCreateError('タイトルを入力してください')
      return
    }

    setCreatePending(true)
    setCreateError('')

    try {
      const created = await createPlaylist(title, createDescription)

      const nextPlaylist: EditablePlaylist = {
        id: created.id,
        title: created.title,
        description: created.description,
        created_at: created.created_at,
        updated_at: created.updated_at,
        items: [],
        savedTitle: created.title,
        savedDescription: created.description ?? '',
      }

      setPlaylists((current) => [nextPlaylist, ...current])
      setPlaylistStates((current) => ({
        [created.id]: getDefaultSaveState(),
        ...current,
      }))
      setExpandedPlaylistId(created.id)
      setCreateTitle('')
      setCreateDescription('')
      setSearchQuery('')
      setSearchResults([])
    } catch (error) {
      console.error(error)
      setCreateError(getErrorMessage(error))
      syncLoginRedirect(error)
    } finally {
      setCreatePending(false)
    }
  }

  const handleDeletePlaylist = async (playlistId: string) => {
    const previousPlaylists = playlists
    const target = playlists.find((playlist) => playlist.id === playlistId)

    if (!target) {
      return
    }

    setPlaylists((current) => current.filter((playlist) => playlist.id !== playlistId))

    if (expandedPlaylistId === playlistId) {
      const nextPlaylist = previousPlaylists.find((playlist) => playlist.id !== playlistId) ?? null
      setExpandedPlaylistId(nextPlaylist?.id ?? null)
    }

    try {
      await deletePlaylist(playlistId, target.updated_at)
    } catch (error) {
      console.error(error)
      setPlaylists(previousPlaylists)
      setExpandedPlaylistId(playlistId)

      if (isConflictError(error)) {
        refreshAfterConflict(playlistId, '別の編集が入ったため最新状態を再読込しています')
        return
      }

      setPlaylistState(playlistId, {
        status: 'error',
        message: getErrorMessage(error),
        busy: false,
        itemId: null,
      })
      syncLoginRedirect(error)
    }
  }

  const handlePlaylistBlur = async (playlistId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId)
    if (!playlist) {
      return
    }

    const normalizedTitle = playlist.title.trim()
    const normalizedDescription = playlist.description ?? ''

    if (!normalizedTitle) {
      updatePlaylistState(playlistId, (current) => ({
        ...current,
        title: current.savedTitle,
        description: current.savedDescription || null,
      }))
      setPlaylistState(playlistId, {
        status: 'error',
        message: 'タイトルを入力してください',
        busy: false,
        itemId: null,
      })
      return
    }

    if (
      normalizedTitle === playlist.savedTitle
      && normalizedDescription === playlist.savedDescription
    ) {
      return
    }

    setPlaylistState(playlistId, {
      status: 'saving',
      message: '保存中…',
      busy: true,
      itemId: null,
    })

    try {
      const updated = await updatePlaylist(
        playlistId,
        normalizedTitle,
        normalizedDescription,
        playlist.updated_at,
      )

      updatePlaylistState(playlistId, (current) => ({
        ...current,
        title: updated.title,
        description: updated.description,
        updated_at: updated.updated_at,
        savedTitle: updated.title,
        savedDescription: updated.description ?? '',
      }))

      setPlaylistState(playlistId, {
        status: 'saved',
        message: DEFAULT_SAVE_MESSAGE,
        busy: false,
        itemId: null,
      })
    } catch (error) {
      console.error(error)

      if (isConflictError(error)) {
        refreshAfterConflict(playlistId, '別の編集が入ったため最新状態を再読込しています')
        return
      }

      updatePlaylistState(playlistId, (current) => ({
        ...current,
        title: current.savedTitle,
        description: current.savedDescription || null,
      }))

      setPlaylistState(playlistId, {
        status: 'error',
        message: getErrorMessage(error),
        busy: false,
        itemId: null,
      })
      syncLoginRedirect(error)
    }
  }

  const handleAddStream = async (playlistId: string, stream: MemberStream) => {
    const playlist = playlists.find((item) => item.id === playlistId)
    if (!playlist) {
      return
    }

    if (playlist.items.some((item) => item.stream_id === stream.id)) {
      return
    }

    const previousItems = playlist.items
    const optimisticItem: MemberPlaylistItem = {
      id: nextOptimisticPlaylistItemId(stream.id),
      playlist_id: playlistId,
      stream_id: stream.id,
      position: toPositionString(computeTargetPosition(previousItems, '__new__', previousItems.length)),
      added_at: new Date().toISOString(),
      stream,
    }

    updatePlaylistState(playlistId, (current) => ({
      ...current,
      items: [...current.items, optimisticItem],
    }))
    setPlaylistState(playlistId, {
      status: 'saving',
      message: '保存中…',
      busy: true,
      itemId: optimisticItem.id,
    })

    try {
      const result = await addStreamToPlaylist(playlistId, stream.video_id, playlist.updated_at)

      updatePlaylistState(playlistId, (current) => ({
        ...current,
        updated_at: result.updatedAt,
        items: current.items.map((item) => (
          item.id === optimisticItem.id
            ? {
              ...item,
              id: result.playlistStream.id,
              position: result.playlistStream.position,
              added_at: result.playlistStream.added_at,
            }
            : item
        )),
      }))
      setPlaylistState(playlistId, {
        status: 'saved',
        message: DEFAULT_SAVE_MESSAGE,
        busy: false,
        itemId: null,
      })

      if (bookmarkedOnly) {
        void toggleBookmark(stream.id).catch(() => undefined)
        setSearchResults((prev) => prev.filter((s) => s.id !== stream.id))
      }
    } catch (error) {
      console.error(error)
      updatePlaylistState(playlistId, (current) => ({
        ...current,
        items: previousItems,
      }))

      if (isConflictError(error)) {
        refreshAfterConflict(playlistId, '別の編集が入ったため最新状態を再読込しています')
        return
      }

      setPlaylistState(playlistId, {
        status: 'error',
        message: getErrorMessage(error),
        busy: false,
        itemId: null,
      })
      syncLoginRedirect(error)
    }
  }

  const handleRemoveStream = async (playlistId: string, item: MemberPlaylistItem) => {
    const playlist = playlists.find((entry) => entry.id === playlistId)
    if (!playlist) {
      return
    }

    const previousItems = playlist.items

    updatePlaylistState(playlistId, (current) => ({
      ...current,
      items: current.items.filter((entry) => entry.id !== item.id),
    }))
    setPlaylistState(playlistId, {
      status: 'saving',
      message: '保存中…',
      busy: true,
      itemId: item.id,
    })

    try {
      const result = await removeStreamFromPlaylist(item.id, playlistId, playlist.updated_at)

      updatePlaylistState(playlistId, (current) => ({
        ...current,
        updated_at: result.updatedAt,
      }))
      setPlaylistState(playlistId, {
        status: 'saved',
        message: DEFAULT_SAVE_MESSAGE,
        busy: false,
        itemId: null,
      })
    } catch (error) {
      console.error(error)
      updatePlaylistState(playlistId, (current) => ({
        ...current,
        items: previousItems,
      }))

      if (isConflictError(error)) {
        refreshAfterConflict(playlistId, '別の編集が入ったため最新状態を再読込しています')
        return
      }

      setPlaylistState(playlistId, {
        status: 'error',
        message: getErrorMessage(error),
        busy: false,
        itemId: null,
      })
      syncLoginRedirect(error)
    }
  }

  const commitReorder = async (playlistId: string, movingItemId: string, nextIndex: number) => {
    const playlist = playlists.find((entry) => entry.id === playlistId)
    if (!playlist) {
      return
    }

    const currentIndex = playlist.items.findIndex((item) => item.id === movingItemId)
    if (currentIndex === -1 || currentIndex === nextIndex) {
      return
    }

    const movingItem = playlist.items[currentIndex]
    const previousItems = playlist.items
    const reorderedItems = arrayMove(previousItems, currentIndex, nextIndex)
    const nextPosition = computeTargetPosition(previousItems, movingItemId, nextIndex)

    updatePlaylistState(playlistId, (current) => ({
      ...current,
      items: reorderedItems.map((item) => (
        item.id === movingItemId
          ? { ...item, position: toPositionString(nextPosition) }
          : item
      )),
    }))
    setPlaylistState(playlistId, {
      status: 'saving',
      message: '保存中…',
      busy: true,
      itemId: movingItemId,
    })

    try {
      const result = await reorderPlaylistStream(
        playlistId,
        movingItem.stream_id,
        nextPosition,
        playlist.updated_at,
      )

      updatePlaylistState(playlistId, (current) => ({
        ...current,
        updated_at: result.updatedAt,
      }))
      setPlaylistState(playlistId, {
        status: 'saved',
        message: DEFAULT_SAVE_MESSAGE,
        busy: false,
        itemId: null,
      })
    } catch (error) {
      console.error(error)
      updatePlaylistState(playlistId, (current) => ({
        ...current,
        items: previousItems,
      }))

      if (isConflictError(error)) {
        refreshAfterConflict(playlistId, '別の編集が入ったため最新状態を再読込しています')
        return
      }

      setPlaylistState(playlistId, {
        status: 'error',
        message: getErrorMessage(error),
        busy: false,
        itemId: null,
      })
      syncLoginRedirect(error)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!currentPlaylist) {
      return
    }

    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    const nextIndex = currentPlaylist.items.findIndex((item) => item.id === over.id)
    if (nextIndex === -1) {
      return
    }

    await commitReorder(currentPlaylist.id, String(active.id), nextIndex)
  }

  const handleMobileMove = async (itemId: string, direction: -1 | 1) => {
    if (!currentPlaylist) {
      return
    }

    const currentIndex = currentPlaylist.items.findIndex((item) => item.id === itemId)
    if (currentIndex === -1) {
      return
    }

    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= currentPlaylist.items.length) {
      return
    }

    await commitReorder(currentPlaylist.id, itemId, nextIndex)
  }

  const handleSubmitEntityRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!entityId) {
      setEntityError('エンティティを選択してください')
      return
    }

    if (!entityWord.trim()) {
      setEntityError('追加ワードを入力してください')
      return
    }

    setEntityPending(true)
    setEntityError('')

    try {
      const created = await submitEntityWordRequest(entityId, entityWord)
      setRequests((current) => [created, ...current])
      setEntityWord('')
    } catch (error) {
      console.error(error)
      setEntityError(getErrorMessage(error))
      syncLoginRedirect(error)
    } finally {
      setEntityPending(false)
    }
  }

  const handleReviewRequest = async (requestId: string, action: 'approve' | 'reject') => {
    setReviewPendingId(requestId)

    try {
      const result = action === 'approve'
        ? await approveEntityWordRequest(requestId)
        : await rejectEntityWordRequest(requestId)

      setRequests((current) => current.map((request) => (
        request.id === requestId ? result : request
      )))
    } catch (error) {
      console.error(error)
      setEntityError(getErrorMessage(error))
      syncLoginRedirect(error)
    } finally {
      setReviewPendingId(null)
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[28px] border border-gray-800 bg-gray-900/90 p-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setActiveTab('playlists')}
            className={`min-h-11 rounded-[22px] border px-4 py-3 text-sm font-medium transition ${
              activeTab === 'playlists'
                ? 'border-white bg-white text-gray-950'
                : 'border-transparent text-gray-400 hover:border-gray-800 hover:text-white'
            }`}
          >
            プレイリスト管理
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('entities')}
            className={`min-h-11 rounded-[22px] border px-4 py-3 text-sm font-medium transition ${
              activeTab === 'entities'
                ? 'border-white bg-white text-gray-950'
                : 'border-transparent text-gray-400 hover:border-gray-800 hover:text-white'
            }`}
          >
            エンティティ申請
          </button>
        </div>
      </div>

      {activeTab === 'playlists' ? (
        <div className="space-y-6">
          <section className="rounded-[28px] border border-gray-800 bg-gray-900 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
                  new playlist
                </p>
                <h2 className="text-2xl font-semibold text-white">
                  キュレーションを組む
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-gray-400">
                  保存じゃない。文脈を並べる。タイトルと説明まで入れて、意図が伝わる形にする。
                </p>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3 text-xs text-gray-400">
                編集者: <span className="text-gray-200">{currentUser.email}</span>
              </div>
            </div>

            <form onSubmit={handleCreatePlaylist} className="mt-6 grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-2">
                <label htmlFor="create-playlist-title" className="text-sm font-medium text-gray-200">
                  タイトル
                </label>
                <input
                  id="create-playlist-title"
                  value={createTitle}
                  onChange={(event) => setCreateTitle(event.target.value)}
                  placeholder="例: ドラクエ11 初見導線"
                  className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="create-playlist-description" className="text-sm font-medium text-gray-200">
                  説明
                </label>
                <textarea
                  id="create-playlist-description"
                  value={createDescription}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  placeholder="このプレイリストで何を体験させたいか"
                  rows={3}
                  className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={createPending}
                  className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createPending ? '作成中…' : '+ 新しいプレイリストを作成'}
                </button>

                {createError ? (
                  <p className="text-sm text-red-300">{createError}</p>
                ) : (
                  <p className="text-sm text-gray-500">作成後すぐ編集モードを開く。</p>
                )}
              </div>
            </form>
          </section>

          <section className="rounded-[28px] border border-gray-800 bg-gray-900 p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
                  library
                </p>
                <h3 className="text-xl font-semibold text-white">
                  プレイリスト一覧
                </h3>
              </div>
              <p className="text-sm text-gray-500">
                {playlists.length.toLocaleString()} 件
              </p>
            </div>

            <div className="mt-6 space-y-4">
              {playlists.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-gray-800 bg-gray-950/60 px-6 py-8">
                  <p className="text-sm font-medium text-gray-300">プレイリストの作り方</p>
                  <ol className="mt-4 space-y-4">
                    {([
                      { step: '01', text: '配信ページを開いて ♥ をタップ。気になる配信をブックマークしておく。' },
                      { step: '02', text: '上のフォームでプレイリストを作成。タイトルと説明を入れて「作成」を押すと編集モードが開く。' },
                      { step: '03', text: '編集エリアの「☆ ブックマーク済みのみ」を押してブックマーク一覧を表示し、＋ で追加。追加した配信のブックマークは自動で解除される。' },
                    ] as const).map(({ step, text }) => (
                      <li key={step} className="flex items-start gap-4">
                        <span className="flex-shrink-0 text-xs font-semibold tabular-nums text-gray-600">{step}</span>
                        <p className="text-sm leading-6 text-gray-400">{text}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                playlists.map((playlist) => {
                  const isExpanded = playlist.id === expandedPlaylistId
                  const saveState = playlistStates[playlist.id] ?? getDefaultSaveState()

                  return (
                    <article
                      key={playlist.id}
                      className="overflow-hidden rounded-[26px] border border-gray-800 bg-gray-950/70"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-lg font-semibold text-white">
                              {playlist.title}
                            </h4>
                            {isExpanded ? <TagPill tone="indigo">編集中</TagPill> : null}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>作成日: {formatDate(playlist.created_at)}</span>
                            <span>{playlist.items.length.toLocaleString()} 本</span>
                            <span>更新: {formatDateTime(playlist.updated_at)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedPlaylistId(isExpanded ? null : playlist.id)}
                            className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                          >
                            {isExpanded ? '閉じる' : '編集'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePlaylist(playlist.id)}
                            className="rounded-xl border border-red-900/70 px-3 py-2 text-sm text-red-200 transition hover:border-red-700 hover:bg-red-950/40"
                          >
                            削除
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-gray-800 px-5 py-5">
                          <div className="grid gap-5 lg:grid-cols-[0.98fr_1.02fr]">
                            <div className="space-y-4">
                              <SaveStatusBar state={saveState} />

                              <div className="grid gap-4">
                                <div className="space-y-2">
                                  <label
                                    htmlFor={`playlist-title-${playlist.id}`}
                                    className="text-sm font-medium text-gray-200"
                                  >
                                    タイトル
                                  </label>
                                  <input
                                    id={`playlist-title-${playlist.id}`}
                                    value={playlist.title}
                                    onChange={(event) => updatePlaylistState(playlist.id, (current) => ({
                                      ...current,
                                      title: event.target.value,
                                    }))}
                                    onBlur={() => void handlePlaylistBlur(playlist.id)}
                                    className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                                  />
                                </div>

                                <div className="space-y-2">
                                  <label
                                    htmlFor={`playlist-description-${playlist.id}`}
                                    className="text-sm font-medium text-gray-200"
                                  >
                                    説明
                                  </label>
                                  <textarea
                                    id={`playlist-description-${playlist.id}`}
                                    rows={4}
                                    value={playlist.description ?? ''}
                                    onChange={(event) => updatePlaylistState(playlist.id, (current) => ({
                                      ...current,
                                      description: event.target.value,
                                    }))}
                                    onBlur={() => void handlePlaylistBlur(playlist.id)}
                                    className="w-full rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                                  />
                                </div>
                              </div>

                              <div className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-white">ストリームを追加</p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      タイトル ILIKE 検索。ブックマーク表示中だけ、テキスト検索はタイトル・要約基準になる。
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setBookmarkedOnly((current) => !current)}
                                    className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                                      bookmarkedOnly
                                        ? 'border-amber-700 bg-amber-500/10 text-amber-200'
                                        : 'border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white'
                                    }`}
                                  >
                                    {bookmarkedOnly ? '★ ブックマーク表示中' : '☆ ブックマーク済みのみ'}
                                  </button>
                                </div>

                                <div className="mt-4 space-y-3">
                                  <input
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder={bookmarkedOnly ? 'タイトル・要約で検索' : 'タイトルで検索'}
                                    className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                                  />

                                  {searchError ? (
                                    <p className="text-sm text-red-300">{searchError}</p>
                                  ) : null}

                                  {searchPending ? (
                                    <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-sm text-gray-400">
                                      候補を引いてる。少し待て。
                                    </div>
                                  ) : searchResults.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 px-4 py-4 text-sm text-gray-500">
                                      {searchQuery.trim() || bookmarkedOnly
                                        ? '候補が見つからない。'
                                        : '検索すると候補がここに並ぶ。'}
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      {searchResults.map((stream) => {
                                        const alreadyAdded = playlist.items.some((item) => item.stream_id === stream.id)
                                        return (
                                          <div
                                            key={stream.id}
                                            className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4"
                                          >
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
                                                  {stream.video_id}
                                                </p>
                                                <h5 className="mt-1 text-sm font-medium leading-6 text-white">
                                                  {stream.title}
                                                </h5>
                                                <p className="mt-1 text-xs text-gray-500">
                                                  {formatDate(stream.stream_date)}
                                                </p>
                                              </div>

                                              <button
                                                type="button"
                                                disabled={alreadyAdded || saveState.busy}
                                                onClick={() => void handleAddStream(playlist.id, stream)}
                                                className="rounded-xl border border-indigo-800 bg-indigo-950/50 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:border-indigo-600 hover:bg-indigo-950 disabled:cursor-not-allowed disabled:opacity-40"
                                              >
                                                {alreadyAdded ? '追加済み' : '追加'}
                                              </button>
                                            </div>

                                            <div className="mt-3 flex flex-wrap gap-2">
                                              {(stream.corner_names ?? []).slice(0, 3).map((cornerName) => (
                                                <TagPill key={cornerName} tone="indigo">
                                                  {cornerName}
                                                </TagPill>
                                              ))}
                                              {(stream.tags ?? []).slice(0, 4).map((tag) => (
                                                <TagPill key={tag}>{tag}</TagPill>
                                              ))}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-4">
                                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4">
                                  <div>
                                    <p className="text-sm font-medium text-white">プレイリスト内容</p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      {isCoarsePointer
                                        ? 'モバイルでは ↑↓ で並び替える。保存中は全行ロック。'
                                        : 'デスクトップではドラッグして順番を入れ替える。'}
                                    </p>
                                  </div>
                                  <div className="rounded-full border border-gray-800 bg-gray-950 px-3 py-1 text-xs text-gray-400">
                                    {playlist.items.length.toLocaleString()} 本
                                  </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                  {playlist.items.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 px-4 py-8 text-sm text-gray-500">
                                      まだ空だ。右側の候補から一本足して流れを作る。
                                    </div>
                                  ) : isCoarsePointer ? (
                                    playlist.items.map((item, index) => (
                                      <MobilePlaylistItem
                                        key={item.id}
                                        item={item}
                                        index={index}
                                        total={playlist.items.length}
                                        busy={saveState.busy}
                                        rowMessage={
                                          saveState.status === 'saving' && saveState.itemId === item.id
                                            ? '保存中…'
                                            : saveState.status === 'error' && saveState.itemId === item.id
                                              ? saveState.message
                                              : null
                                        }
                                        onMove={(itemId, direction) => void handleMobileMove(itemId, direction)}
                                        onRemove={(itemToRemove) => void handleRemoveStream(playlist.id, itemToRemove)}
                                      />
                                    ))
                                  ) : (
                                    <DndContext
                                      id={`playlist-dnd-${playlist.id}`}
                                      sensors={sensors}
                                      collisionDetection={closestCenter}
                                      onDragEnd={(event) => void handleDragEnd(event)}
                                    >
                                      <SortableContext
                                        items={playlist.items.map((item) => item.id)}
                                        strategy={verticalListSortingStrategy}
                                      >
                                        <div className="space-y-3">
                                          {playlist.items.map((item, index) => (
                                            <SortablePlaylistItem
                                              key={item.id}
                                              item={item}
                                              index={index}
                                              busy={saveState.busy}
                                              rowMessage={
                                                saveState.status === 'saving' && saveState.itemId === item.id
                                                  ? '保存中…'
                                                  : saveState.status === 'error' && saveState.itemId === item.id
                                                    ? saveState.message
                                                    : null
                                              }
                                              onRemove={(itemToRemove) => void handleRemoveStream(playlist.id, itemToRemove)}
                                            />
                                          ))}
                                        </div>
                                      </SortableContext>
                                    </DndContext>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-gray-800 bg-gray-900 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
                entity request
              </p>
              <h2 className="text-2xl font-semibold text-white">
                エンティティに別名を足す
              </h2>
              <p className="text-sm leading-7 text-gray-400">
                読みや表記ゆれを補って、検索の引っかかりを良くする。
              </p>
            </div>

            <form onSubmit={handleSubmitEntityRequest} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label htmlFor="entity-select" className="text-sm font-medium text-gray-200">
                  エンティティ
                </label>
                <select
                  id="entity-select"
                  value={entityId}
                  onChange={(event) => setEntityId(event.target.value)}
                  className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                >
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="entity-word" className="text-sm font-medium text-gray-200">
                  追加ワード
                </label>
                <input
                  id="entity-word"
                  value={entityWord}
                  onChange={(event) => setEntityWord(event.target.value)}
                  placeholder="例: DQ11 / ドラゴンクエスト11"
                  className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={entityPending}
                  className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {entityPending ? '申請中…' : '申請する'}
                </button>

                {entityError ? (
                  <p className="text-sm text-red-300">{entityError}</p>
                ) : null}
              </div>
            </form>
          </div>

          <div className="rounded-[28px] border border-gray-800 bg-gray-900 p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
                  requests
                </p>
                <h3 className="text-xl font-semibold text-white">
                  {role === 'admin' ? '全申請一覧' : '自分の申請一覧'}
                </h3>
              </div>
              <p className="text-sm text-gray-500">
                {requests.length.toLocaleString()} 件
              </p>
            </div>

            <div className="mt-6 space-y-3">
              {requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 px-4 py-8 text-sm text-gray-500">
                  申請はまだない。
                </div>
              ) : (
                requests.map((request) => {
                  const isPending = request.status === 'pending'
                  const tone = request.status === 'approved'
                    ? 'border-emerald-900/80 bg-emerald-500/10 text-emerald-200'
                    : request.status === 'rejected'
                      ? 'border-red-900/80 bg-red-500/10 text-red-200'
                      : 'border-amber-800/80 bg-amber-500/10 text-amber-200'

                  return (
                    <article
                      key={request.id}
                      className="rounded-[22px] border border-gray-800 bg-gray-950/70 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-medium text-white">
                              {request.word}
                            </h4>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
                              {request.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-400">
                            {entityNameMap.get(request.entity_id) ?? 'Unknown entity'}
                          </p>
                          <p className="text-xs text-gray-500">
                            申請日時: {formatDateTime(request.requested_at)}
                          </p>
                        </div>

                        {role === 'admin' && isPending ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={reviewPendingId === request.id}
                              onClick={() => void handleReviewRequest(request.id, 'approve')}
                              className="rounded-xl border border-emerald-900/80 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              承認
                            </button>
                            <button
                              type="button"
                              disabled={reviewPendingId === request.id}
                              onClick={() => void handleReviewRequest(request.id, 'reject')}
                              className="rounded-xl border border-red-900/80 px-3 py-2 text-xs font-medium text-red-200 transition hover:border-red-700 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              却下
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </div>
        </section>
      )}
    </section>
  )
}
