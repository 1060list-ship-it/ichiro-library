export type Highlight = {
  start_sec: number
  quote: string
  reason: '笑い' | '名言' | '感動' | '驚き' | '神回'
}

export type Stream = {
  id: string
  video_id: string
  title: string
  stream_date: string
  started_at: string | null
  duration_min: number | null
  view_count: number | null
  view_count_7d: number | null
  comment_count: number | null
  summary: string | null
  tags: string[] | null
  corner_names: string[] | null
  guests: string[] | null
  like_count: number | null
  songs: string[] | null
  has_live_singing: boolean | null
  has_live_viewing: boolean | null
  talk_topics: string[] | null
  highlights: Highlight[] | null
  youtube_url: string | null
  thumbnail_url: string | null
  status: string
  is_reviewed: boolean
  needs_manual_review: boolean | null
  avg_rating: number
  rating_count: number
  created_at: string
  updated_at: string
}

export type Chapter = {
  id: string
  stream_id: string
  start_sec: number
  end_sec: number | null
  title: string
  summary: string | null
  transcript_segment: string | null
  sort_order: number
  created_at: string
}

export type Rating = {
  id: string
  stream_id: string
  user_hash: string
  rating: number
  created_at: string
}

export type Entity = {
  id: string
  slug: string
  name: string
  match_names: string[]
  category: 'family' | 'celebrity' | 'remixer' | 'team' | 'craftsman' | 'product' | 'project' | string
  role: string | null
  description: string
  related_work: string | null
  external_url: string | null
  sort_order: number | null
  created_at: string
  updated_at: string
}

export type StreamEntity = {
  stream_id: string
  entity_id: string
}

export type MagazineEntity = {
  magazine_id: string
  entity_id: string
}

export type UserRole = 'editor' | 'admin'

export type Playlist = {
  id: string
  title: string
  description: string | null
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type PlaylistStream = {
  id: string
  playlist_id: string
  stream_id: string
  position: string
  added_by: string | null
  added_at: string
}

export type Bookmark = {
  user_id: string
  stream_id: string
  created_at: string
}

export type EntityWordRequest = {
  id: string
  entity_id: string
  word: string
  status: 'pending' | 'approved' | 'rejected'
  requested_by: string | null
  reviewed_by: string | null
  requested_at: string
  reviewed_at: string | null
}

export type SearchLog = {
  id: string
  query: string | null
  result_count: number | null
  user_id: string | null
  searched_at: string
}

export type SearchStreamsArgs = {
  query?: string | null
  date_from?: string | null
  date_to?: string | null
  filter_tags?: string[] | null
  filter_corners?: string[] | null
  filter_guests?: string[] | null
  filter_entity_id?: string | null
  sort_by?: string | null
  page_num?: number | null
  page_size?: number | null
}

export type EngagementRankingArgs = {
  limit_n?: number | null
  date_from?: string | null
  date_to?: string | null
}

export type Database = {
  public: {
    Tables: {
      streams: { Row: Stream; Insert: Omit<Stream, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Stream>; Relationships: [] }
      chapters: { Row: Chapter; Insert: Omit<Chapter, 'id' | 'created_at'>; Update: Partial<Chapter>; Relationships: [] }
      ratings: { Row: Rating; Insert: Omit<Rating, 'id' | 'created_at'>; Update: Partial<Rating>; Relationships: [] }
      entities: { Row: Entity; Insert: Omit<Entity, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Entity>; Relationships: [] }
      stream_entities: { Row: StreamEntity; Insert: StreamEntity; Update: Partial<StreamEntity>; Relationships: [] }
      magazine_entities: { Row: MagazineEntity; Insert: MagazineEntity; Update: Partial<MagazineEntity>; Relationships: [] }
      user_roles: {
        Row: { user_id: string; role: UserRole; granted_by: string | null; granted_at: string | null }
        Insert: { user_id: string; role: UserRole; granted_by?: string | null; granted_at?: string | null }
        Update: { user_id?: string; role?: UserRole; granted_by?: string | null; granted_at?: string | null }
        Relationships: []
      }
      playlists: {
        Row: Playlist
        Insert: Omit<Playlist, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string | null; updated_at?: string | null }
        Update: Partial<Playlist>
        Relationships: []
      }
      playlist_streams: {
        Row: PlaylistStream
        Insert: Omit<PlaylistStream, 'id' | 'added_at'> & { id?: string; added_at?: string | null }
        Update: Partial<PlaylistStream>
        Relationships: []
      }
      bookmarks: {
        Row: Bookmark
        Insert: Omit<Bookmark, 'created_at'> & { created_at?: string | null }
        Update: Partial<Bookmark>
        Relationships: []
      }
      entity_word_requests: {
        Row: EntityWordRequest
        Insert: Omit<EntityWordRequest, 'id' | 'status' | 'requested_at' | 'reviewed_at'> & {
          id?: string
          status?: EntityWordRequest['status'] | null
          requested_at?: string | null
          reviewed_at?: string | null
        }
        Update: Partial<EntityWordRequest>
        Relationships: []
      }
      search_logs: {
        Row: SearchLog
        Insert: Omit<SearchLog, 'id' | 'searched_at'> & { id?: string; searched_at?: string | null }
        Update: Partial<SearchLog>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_engagement_ranking: {
        Args: EngagementRankingArgs
        Returns: Stream[]
      }
      search_streams: {
        Args: SearchStreamsArgs
        Returns: (Omit<Stream, 'like_count' | 'songs' | 'has_live_singing' | 'has_live_viewing' | 'talk_topics' | 'highlights' | 'status' | 'ai_model' | 'ai_prompt_ver' | 'is_reviewed' | 'created_at' | 'updated_at'> & { total_count: number })[]
      }
    }
  }
}
