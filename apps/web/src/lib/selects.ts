export const PUBLIC_STREAM_CARD_SELECT = [
  'id',
  'video_id',
  'title',
  'stream_date',
  'duration_min',
  'view_count',
  'comment_count',
  'summary',
  'tags',
  'thumbnail_url',
].join(', ')

export const PUBLIC_STREAM_DETAIL_SELECT = [
  'id',
  'video_id',
  'title',
  'stream_date',
  'duration_min',
  'view_count',
  'summary',
  'tags',
  'corner_names',
  'guests',
  'highlights',
].join(', ')

export const PUBLIC_STREAM_LIST_SELECT = [
  'id',
  'video_id',
  'title',
  'stream_date',
  'thumbnail_url',
  'summary',
].join(', ')

export const PUBLIC_STREAM_PLAYLIST_SELECT = [
  'id',
  'video_id',
  'title',
  'stream_date',
  'thumbnail_url',
  'view_count',
].join(', ')

export const PUBLIC_STREAM_MAGAZINE_MAP_SELECT = [
  'video_id',
  'title',
  'stream_date',
].join(', ')

export const PUBLIC_CHAPTER_LIST_SELECT = [
  'id',
  'start_sec',
  'title',
  'summary',
].join(', ')

export const PUBLIC_ENTITY_LINK_SELECT = [
  'slug',
  'name',
  'match_names',
].join(', ')

export const PUBLIC_ENTITY_INDEX_SELECT = [
  'id',
  'slug',
  'name',
  'category',
  'role',
  'description',
].join(', ')

export const PUBLIC_ENTITY_DETAIL_SELECT = [
  'id',
  'slug',
  'name',
  'category',
  'role',
  'description',
  'related_work',
  'external_url',
].join(', ')

export const PUBLIC_PLAYLIST_LIST_SELECT = [
  'id',
  'title',
  'description',
].join(', ')

export const PUBLIC_MAGAZINE_SELECT = [
  'id',
  'week_label',
  'week_start',
  'week_end',
  'content',
  'cover_image_url',
  'stream_ids',
].join(', ')

export const ADMIN_ENTITY_SELECT = [
  'id',
  'slug',
  'name',
  'match_names',
  'category',
  'role',
  'description',
  'related_work',
  'external_url',
  'sort_order',
  'created_at',
  'updated_at',
].join(', ')
