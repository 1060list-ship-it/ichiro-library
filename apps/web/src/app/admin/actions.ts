'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Database, Stream } from '@/lib/types'

const ADMIN_COOKIE_NAME = 'ichiro-library-admin'

export type AdminDashboardData = {
  summary: {
    totalCount: number
    unreviewedCount: number
    transcriptFailedCount: number
  }
  unreviewedStreams: AdminListStream[]
  failedStreams: AdminListStream[]
}

export type AdminListStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'status' | 'thumbnail_url' | 'is_reviewed'>

export type AdminEditableStream = Pick<
  Stream,
  | 'id'
  | 'video_id'
  | 'title'
  | 'stream_date'
  | 'status'
  | 'thumbnail_url'
  | 'youtube_url'
  | 'is_reviewed'
  | 'summary'
  | 'tags'
  | 'corner_names'
  | 'guests'
  | 'songs'
  | 'has_live_singing'
  | 'has_live_viewing'
  | 'talk_topics'
> & {
  supportsLiveViewing: boolean
}

export type UpdateAdminStreamInput = {
  videoId: string
  summary: string
  tags: string
  cornerNames: string
  guests: string
  songs: string
  hasLiveSinging: boolean
  hasLiveViewing: boolean
  talkTopics: string
  isReviewed: boolean
}

export type AdminStreamSearchInput = {
  query?: string
  startDate?: string
  endDate?: string
  limit?: number
}

export type AdminStreamPage = {
  streams: AdminListStream[]
  hasMore: boolean
}

export type EnqueueJobInput =
  | { kind: 'fetch_new'; days?: number; maxVideos?: number }
  | { kind: 'reprocess' }
  | { kind: 'reprocess_single'; videoId: string }

export type PipelineJob = {
  id: string
  kind: string
  video_id: string | null
  payload: Record<string, unknown> | null
  status: string
  error_msg: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
}

type StreamUpdate = Database['public']['Tables']['streams']['Update']

const ADMIN_STREAM_SELECT_BASE = `
  id,
  video_id,
  title,
  stream_date,
  status,
  thumbnail_url,
  youtube_url,
  is_reviewed,
  summary,
  tags,
  corner_names,
  guests,
  songs,
  has_live_singing,
  talk_topics
`

const ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING = `
  ${ADMIN_STREAM_SELECT_BASE},
  has_live_viewing
`

function isMissingLiveViewingColumn(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : ''

  return message.includes('has_live_viewing')
}

function getAdminPassword() {
  const password = process.env.ADMIN_PASSWORD

  if (!password) {
    throw new Error('ADMIN_PASSWORD が未設定です')
  }

  return password
}

function getAdminCookieValue() {
  return createHash('sha256')
    .update(`ichiro-library:${getAdminPassword()}`)
    .digest('hex')
}

async function requireAdminSession() {
  const cookieStore = await cookies()
  const current = cookieStore.get(ADMIN_COOKIE_NAME)?.value

  if (current !== getAdminCookieValue()) {
    throw new Error('Unauthorized')
  }
}

function normalizeCsv(value: string) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return items.length > 0 ? items : null
}

function toEditableStream(stream: AdminEditableStream): AdminEditableStream {
  return {
    ...stream,
    youtube_url: stream.youtube_url ?? `https://www.youtube.com/watch?v=${stream.video_id}`,
  }
}

function toEditableStreamWithoutLiveViewing(
  stream: Omit<AdminEditableStream, 'has_live_viewing' | 'supportsLiveViewing'> & { has_live_viewing?: boolean | null }
): AdminEditableStream {
  return toEditableStream({
    ...stream,
    has_live_viewing: stream.has_live_viewing ?? null,
    supportsLiveViewing: false,
  })
}

export async function verifyAdminPassword(password: string) {
  if (password !== getAdminPassword()) {
    return { ok: false as const, message: 'パスワードが違います。' }
  }

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_COOKIE_NAME, getAdminCookieValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })

  return { ok: true as const }
}

export async function checkAdminSession() {
  const cookieStore = await cookies()
  return cookieStore.get(ADMIN_COOKIE_NAME)?.value === getAdminCookieValue()
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_COOKIE_NAME)
}

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  await requireAdminSession()

  const [
    totalResult,
    unreviewedCountResult,
    failedCountResult,
    unreviewedStreamsResult,
    failedStreamsResult,
  ] = await Promise.all([
    supabaseAdmin.from('streams').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('streams').select('id', { count: 'exact', head: true }).eq('is_reviewed', false),
    supabaseAdmin.from('streams').select('id', { count: 'exact', head: true }).eq('status', 'transcript_failed'),
    supabaseAdmin
      .from('streams')
      .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed')
      .eq('is_reviewed', false)
      .order('stream_date', { ascending: false }),
    supabaseAdmin
      .from('streams')
      .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed')
      .eq('status', 'transcript_failed')
      .order('stream_date', { ascending: false }),
  ])

  if (totalResult.error) throw totalResult.error
  if (unreviewedCountResult.error) throw unreviewedCountResult.error
  if (failedCountResult.error) throw failedCountResult.error
  if (unreviewedStreamsResult.error) throw unreviewedStreamsResult.error
  if (failedStreamsResult.error) throw failedStreamsResult.error

  return {
    summary: {
      totalCount: totalResult.count ?? 0,
      unreviewedCount: unreviewedCountResult.count ?? 0,
      transcriptFailedCount: failedCountResult.count ?? 0,
    },
    unreviewedStreams: unreviewedStreamsResult.data ?? [],
    failedStreams: failedStreamsResult.data ?? [],
  }
}

export async function searchAdminStreams(input: AdminStreamSearchInput): Promise<AdminListStream[]> {
  await requireAdminSession()

  const normalized = input.query?.trim() ?? ''
  const startDate = input.startDate?.trim() ?? ''
  const endDate = input.endDate?.trim() ?? ''
  const limit = input.limit ?? 20

  if (!normalized && !startDate && !endDate) {
    return []
  }

  let query = supabaseAdmin
    .from('streams')
    .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed')
    .order('stream_date', { ascending: false })
    .limit(limit)

  if (normalized) {
    query = query.or(`title.ilike.%${normalized}%,video_id.ilike.%${normalized}%`)
  }
  if (startDate) {
    query = query.gte('stream_date', startDate)
  }
  if (endDate) {
    query = query.lte('stream_date', endDate)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? []
}

export async function fetchAdminStreamsPage(offset = 0, limit = 20): Promise<AdminStreamPage> {
  await requireAdminSession()

  const { data, error } = await supabaseAdmin
    .from('streams')
    .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed')
    .eq('is_reviewed', true)
    .order('stream_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw error
  }

  const streams = data ?? []
  return {
    streams,
    hasMore: streams.length === limit,
  }
}

export async function enqueueJob(input: EnqueueJobInput): Promise<PipelineJob> {
  await requireAdminSession()

  const row = {
    kind: input.kind,
    video_id: input.kind === 'reprocess_single' ? input.videoId : null,
    payload: input.kind === 'fetch_new'
      ? { days: input.days ?? 30, max_videos: input.maxVideos ?? 20 }
      : null,
  }

  const { data, error } = await (supabaseAdmin as never as {
    from: (table: 'pipeline_jobs') => {
      insert: (value: unknown) => {
        select: () => {
          single: () => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  })
    .from('pipeline_jobs')
    .insert(row)
    .select()
    .single()

  if (error) {
    throw error
  }

  revalidatePath('/admin')

  return data as PipelineJob
}

export async function fetchRecentJobs(limit = 10): Promise<PipelineJob[]> {
  await requireAdminSession()

  const { data, error } = await (supabaseAdmin as never as {
    from: (table: 'pipeline_jobs') => {
      select: () => {
        order: (column: string, options: { ascending: boolean }) => {
          limit: (value: number) => Promise<{ data: unknown[] | null; error: unknown }>
        }
      }
    }
  })
    .from('pipeline_jobs')
    .select()
    .order('requested_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  return (data ?? []) as PipelineJob[]
}

export async function setAdminStreamReviewed(videoId: string, isReviewed: boolean): Promise<AdminListStream> {
  await requireAdminSession()

  const { data, error } = await supabaseAdmin
    .from('streams')
    .update({ is_reviewed: isReviewed } as never)
    .eq('video_id', videoId)
    .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed')
    .single()

  if (error) {
    throw error
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/stream/${videoId}`)

  return data
}

export async function fetchAdminStream(videoId: string): Promise<AdminEditableStream | null> {
  await requireAdminSession()

  const withLiveViewing = await supabaseAdmin
    .from('streams')
    .select(ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING)
    .eq('video_id', videoId)
    .maybeSingle()

  if (!withLiveViewing.error) {
    return withLiveViewing.data
      ? toEditableStream({ ...(withLiveViewing.data as AdminEditableStream), supportsLiveViewing: true })
      : null
  }

  if (!isMissingLiveViewingColumn(withLiveViewing.error)) {
    throw withLiveViewing.error
  }

  const fallback = await supabaseAdmin
    .from('streams')
    .select(ADMIN_STREAM_SELECT_BASE)
    .eq('video_id', videoId)
    .maybeSingle()

  if (fallback.error) {
    throw fallback.error
  }

  return fallback.data ? toEditableStreamWithoutLiveViewing(fallback.data) : null
}

export async function updateAdminStream(input: UpdateAdminStreamInput): Promise<AdminEditableStream> {
  await requireAdminSession()

  const updates: StreamUpdate = {
    summary: input.summary.trim() || null,
    tags: normalizeCsv(input.tags),
    corner_names: normalizeCsv(input.cornerNames),
    guests: normalizeCsv(input.guests),
    songs: normalizeCsv(input.songs),
    has_live_singing: input.hasLiveSinging,
    has_live_viewing: input.hasLiveViewing,
    talk_topics: normalizeCsv(input.talkTopics),
    is_reviewed: input.isReviewed,
  }

  const withLiveViewing = await supabaseAdmin
    .from('streams')
    .update(updates as never)
    .eq('video_id', input.videoId)
    .select(ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING)
    .single()

  let data: AdminEditableStream

  if (!withLiveViewing.error) {
    data = toEditableStream({ ...(withLiveViewing.data as AdminEditableStream), supportsLiveViewing: true })
  } else if (isMissingLiveViewingColumn(withLiveViewing.error)) {
    const fallbackUpdates = { ...updates }
    delete fallbackUpdates.has_live_viewing

    const fallback = await supabaseAdmin
      .from('streams')
      .update(fallbackUpdates as never)
      .eq('video_id', input.videoId)
      .select(ADMIN_STREAM_SELECT_BASE)
      .single()

    if (fallback.error) {
      throw fallback.error
    }

    data = toEditableStreamWithoutLiveViewing(fallback.data)
  } else {
    throw withLiveViewing.error
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/stream/${input.videoId}`)

  return data
}

export async function markStreamReviewed(videoId: string): Promise<AdminEditableStream> {
  await requireAdminSession()

  const updates: StreamUpdate = { is_reviewed: true }

  const withLiveViewing = await supabaseAdmin
    .from('streams')
    .update(updates as never)
    .eq('video_id', videoId)
    .select(ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING)
    .single()

  let data: AdminEditableStream

  if (!withLiveViewing.error) {
    data = toEditableStream({ ...(withLiveViewing.data as AdminEditableStream), supportsLiveViewing: true })
  } else if (isMissingLiveViewingColumn(withLiveViewing.error)) {
    const fallback = await supabaseAdmin
      .from('streams')
      .update(updates as never)
      .eq('video_id', videoId)
      .select(ADMIN_STREAM_SELECT_BASE)
      .single()

    if (fallback.error) {
      throw fallback.error
    }

    data = toEditableStreamWithoutLiveViewing(fallback.data)
  } else {
    throw withLiveViewing.error
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/stream/${videoId}`)

  return data
}
