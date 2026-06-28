declare global {
  interface Window {
    YT?: typeof YT
    onYouTubeIframeAPIReady: (() => void) | null
  }

  namespace YT {
    interface PlayerOptions {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: PlayerEvent) => void
        onStateChange?: (event: OnStateChangeEvent) => void
      }
    }

    interface PlayerEvent {
      target: Player
    }

    interface OnStateChangeEvent extends PlayerEvent {
      data: number
    }

    interface VideoData {
      video_id?: string
    }

    interface PlayerStateMap {
      ENDED: 0
      PLAYING: 1
      PAUSED: 2
      BUFFERING: 3
      CUED: 5
      UNSTARTED: -1
    }

    class Player {
      constructor(elementId: string | HTMLElement, options?: PlayerOptions)
      destroy(): void
      loadVideoById(videoId: string): void
      getVideoData(): VideoData
    }

    const PlayerState: PlayerStateMap
  }
}

export {}
