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
  talk_topics: string[] | null
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

export type Database = {
  public: {
    Tables: {
      streams: { Row: Stream; Insert: Omit<Stream, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Stream> }
      chapters: { Row: Chapter; Insert: Omit<Chapter, 'id' | 'created_at'>; Update: Partial<Chapter> }
      ratings: { Row: Rating; Insert: Omit<Rating, 'id' | 'created_at'>; Update: Partial<Rating> }
    }
  }
}
