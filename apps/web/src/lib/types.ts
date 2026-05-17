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

export type SearchStreamsArgs = {
  query?: string | null
  date_from?: string | null
  date_to?: string | null
  filter_tags?: string[] | null
  filter_corners?: string[] | null
  filter_guests?: string[] | null
  sort_by?: string | null
  page_num?: number | null
  page_size?: number | null
}

export type Database = {
  public: {
    Tables: {
      streams: { Row: Stream; Insert: Omit<Stream, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Stream> }
      chapters: { Row: Chapter; Insert: Omit<Chapter, 'id' | 'created_at'>; Update: Partial<Chapter> }
      ratings: { Row: Rating; Insert: Omit<Rating, 'id' | 'created_at'>; Update: Partial<Rating> }
    }
    Functions: {
      search_streams: {
        Args: SearchStreamsArgs
        Returns: (Omit<Stream, 'like_count' | 'songs' | 'has_live_singing' | 'has_live_viewing' | 'talk_topics' | 'highlights' | 'status' | 'ai_model' | 'ai_prompt_ver' | 'is_reviewed' | 'created_at' | 'updated_at'> & { total_count: number })[]
      }
    }
  }
}
