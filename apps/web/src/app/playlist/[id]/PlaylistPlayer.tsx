'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import PlaylistStreamRow from '@/components/PlaylistStreamRow'
import type { Playlist, Stream, UserRole } from '@/lib/types'
import { toggleBookmark } from '../../member/actions'

type PlaylistDetail = Pick<Playlist, 'id' | 'title' | 'description'>
type PlaylistPlayerStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'thumbnail_url' | 'view_count'>

type Props = {
  playlist: PlaylistDetail
  streams: PlaylistPlayerStream[]
  role: UserRole | null
}

let youtubeIframeApiPromise: Promise<typeof window.YT> | null = null

function loadYouTubeIframeApi() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API can only be loaded in the browser'))
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT)
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    )

    const cleanup = () => {
      window.onYouTubeIframeAPIReady = null
    }

    window.onYouTubeIframeAPIReady = () => {
      cleanup()

      if (window.YT?.Player) {
        resolve(window.YT)
        return
      }

      reject(new Error('YouTube IFrame API loaded without window.YT.Player'))
    }

    if (existingScript) {
      return
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      cleanup()
      youtubeIframeApiPromise = null
      reject(new Error('Failed to load YouTube IFrame API'))
    }

    document.body.appendChild(script)
  })

  return youtubeIframeApiPromise
}

export default function PlaylistPlayer({ playlist, streams, role }: Props) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(streams[0]?.video_id ?? null)
  const [bookmarkedStreamMap, setBookmarkedStreamMap] = useState<Record<string, boolean>>({})
  const [bookmarkPending, startBookmarkTransition] = useTransition()
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const isPlayerReadyRef = useRef(false)
  const activeVideoIdRef = useRef(activeVideoId)

  const activeStream = streams.find((stream) => stream.video_id === activeVideoId) ?? streams[0] ?? null
  const canBookmark = role === 'editor' || role === 'admin'
  const isBookmarked = activeStream ? bookmarkedStreamMap[activeStream.id] ?? false : false

  useEffect(() => {
    activeVideoIdRef.current = activeVideoId
  }, [activeVideoId])

  useEffect(() => {
    if (!playerHostRef.current || !activeVideoIdRef.current) {
      return
    }

    let cancelled = false

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !playerHostRef.current || !activeVideoIdRef.current) {
          return
        }

        playerRef.current?.destroy()

        playerRef.current = new YT.Player(playerHostRef.current, {
          videoId: activeVideoIdRef.current,
          playerVars: {
            autoplay: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              isPlayerReadyRef.current = true
            },
            onStateChange: (event) => {
              if (event.data !== YT.PlayerState.ENDED) {
                return
              }

              const currentIndex = streams.findIndex((stream) => stream.video_id === activeVideoIdRef.current)
              const nextStream = currentIndex >= 0 ? streams[currentIndex + 1] : null

              if (!nextStream) {
                return
              }

              setActiveVideoId(nextStream.video_id)
            },
          },
        })
      })
      .catch((error) => {
        console.error(error)
      })

    return () => {
      cancelled = true
      isPlayerReadyRef.current = false
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [streams])

  useEffect(() => {
    const player = playerRef.current

    if (!player || !activeVideoId || !isPlayerReadyRef.current) {
      return
    }

    if (player.getVideoData().video_id === activeVideoId) {
      return
    }

    player.loadVideoById(activeVideoId)
  }, [activeVideoId])

  function handleBookmark() {
    if (!activeStream) {
      return
    }

    startBookmarkTransition(async () => {
      const result = await toggleBookmark(activeStream.id)

      setBookmarkedStreamMap((current) => ({
        ...current,
        [activeStream.id]: result.bookmarked,
      }))
    })
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/playlists" className="text-sm text-gray-400 transition hover:text-white">
            ← プレイリスト一覧
          </Link>
          <Link href="/" className="text-xs text-gray-500 transition hover:text-gray-300">
            トップ
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="grid gap-6 md:grid-cols-[55%_1fr] md:items-start">
          <section className="space-y-4 md:sticky md:top-0 md:h-fit">
            {activeStream ? (
              <div className="overflow-hidden rounded-2xl border border-gray-800 bg-black">
                <div
                  id="yt-player"
                  ref={playerHostRef}
                  className="aspect-video w-full"
                  aria-label={activeStream.title}
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-2xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
                再生できる配信がありません
              </div>
            )}

            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                    playlist
                  </p>
                  <h1 className="text-2xl font-bold leading-tight text-white">
                    {playlist.title}
                  </h1>
                </div>

                {canBookmark && (
                  <button
                    type="button"
                    disabled={bookmarkPending || !activeStream}
                    onClick={handleBookmark}
                    className="text-xl text-yellow-400"
                    aria-label="ブックマーク"
                  >
                    {isBookmarked ? '★' : '☆'}
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-sm leading-7 text-gray-300">
                  {playlist.description ?? '説明はまだありません。'}
                </p>
                <p className="text-sm text-gray-500">
                  {streams.length.toLocaleString()}本の配信
                </p>

                {activeStream && (
                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                      now playing
                    </p>
                    <p className="mt-2 text-sm font-medium leading-6 text-white">
                      {activeStream.title}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/90 md:h-[calc(100dvh-56px)] md:overflow-y-auto">
            <div className="border-b border-gray-800 px-4 py-3">
              <p className="text-sm font-medium text-white">配信リスト</p>
              <p className="text-xs text-gray-500">{streams.length.toLocaleString()}本</p>
            </div>

            {streams.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400">
                このプレイリストにはまだ配信がありません。
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {streams.map((stream, index) => (
                  <PlaylistStreamRow
                    key={stream.id}
                    stream={stream}
                    position={index + 1}
                    isActive={stream.video_id === activeVideoId}
                    onClick={setActiveVideoId}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
