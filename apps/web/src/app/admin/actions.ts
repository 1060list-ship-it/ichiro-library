'use server'

import { revalidatePath } from 'next/cache'
import {
  logAdminTagUpdateDrops,
  resolveAdminTagUpdate,
  type AdminTagVocabularyEntry,
} from '@/lib/admin-tag-vocabulary'
import { requireRole } from '@/lib/auth'
import { ADMIN_ENTITY_SELECT } from '@/lib/selects'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Database, Highlight, Stream } from '@/lib/types'


export type AdminDashboardData = {
  summary: {
    totalCount: number
    unreviewedCount: number
    transcriptFailedCount: number
  }
  unreviewedStreams: AdminListStream[]
  failedStreams: AdminListStream[]
}

export type AdminListStream = Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'status' | 'thumbnail_url' | 'is_reviewed'> & {
  needs_manual_review: boolean | null
}

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
  | 'highlights'
> & {
  supportsLiveViewing: boolean
}

export type AdminChapter = {
  id: string
  start_sec: number
  end_sec: number | null
  title: string
  summary: string | null
  sort_order: number
}

export type UpdateAdminStreamInput = {
  videoId: string
  summary: string
  tags?: string[] | null
  cornerNames: string
  guests: string
  songs: string
  hasLiveSinging: boolean
  hasLiveViewing: boolean
  talkTopics: string
  highlights: Highlight[]
  isReviewed: boolean
}

export type UpdateAdminStreamResult = {
  ok: true
  stream: AdminEditableStream
  droppedInvalidTags: string[]
  droppedInactiveTags: string[]
}

export type SaveAdminChaptersInput = {
  videoId: string
  chapters: Omit<AdminChapter, 'id' | 'sort_order'>[]
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

export type SearchLogStats = {
  topQueries: { query: string; count: number }[]
  dailyCounts: { date: string; count: number }[]
}

export type EnqueueJobInput =
  | { kind: 'fetch_new'; days?: number; maxVideos?: number }
  | { kind: 'reprocess' }
  | { kind: 'reprocess_single'; videoId: string }
  | { kind: 'weekly_magazine'; date?: string }

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
type ChapterInsert = Database['public']['Tables']['chapters']['Insert']
type AdminStreamUpdate = StreamUpdate & { highlights?: Highlight[] | null }
type SearchLogRow = Database['public']['Tables']['search_logs']['Row']
type SearchLogQueryRow = Pick<SearchLogRow, 'query'>
type SearchLogDateRow = Pick<SearchLogRow, 'searched_at'>

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
  highlights,
  talk_topics
`

const ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING = `
  ${ADMIN_STREAM_SELECT_BASE},
  has_live_viewing
`

const SEARCH_LOG_BATCH_SIZE = 1000
const SEARCH_LOG_DAILY_WINDOW_DAYS = 30
const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isMissingLiveViewingColumn(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : ''

  return message.includes('has_live_viewing')
}

function normalizeCsv(value: string) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return items.length > 0 ? items : null
}

async function fetchAllSearchLogPages<T>(fetchPage: (offset: number, limit: number) => Promise<T[]>) {
  const rows: T[] = []

  for (let offset = 0; ; offset += SEARCH_LOG_BATCH_SIZE) {
    const page = await fetchPage(offset, SEARCH_LOG_BATCH_SIZE)
    rows.push(...page)

    if (page.length < SEARCH_LOG_BATCH_SIZE) {
      break
    }
  }

  return rows
}

function formatTokyoDate(value: string) {
  const parts = TOKYO_DATE_FORMATTER.formatToParts(new Date(value))

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''

  return `${year}-${month}-${day}`
}

async function findStreamIdByVideoId(videoId: string): Promise<string | null> {
  const streamResult = await supabaseAdmin
    .from('streams')
    .select('id')
    .eq('video_id', videoId)
    .maybeSingle()

  const data = streamResult.data as Pick<Stream, 'id'> | null
  const { error } = streamResult

  if (error) {
    throw error
  }

  return data?.id ?? null
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

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  await requireRole(['admin'])

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
      .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed, needs_manual_review')
      .eq('is_reviewed', false)
      .order('stream_date', { ascending: false }),
    supabaseAdmin
      .from('streams')
      .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed, needs_manual_review')
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

export async function fetchSearchLogStats(): Promise<SearchLogStats> {
  await requireRole(['admin'])

  const dailyWindowStart = new Date(Date.now() - SEARCH_LOG_DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [topQueryRows, dailyRows] = await Promise.all([
    fetchAllSearchLogPages<SearchLogQueryRow>(async (offset, limit) => {
      const { data, error } = await supabaseAdmin
        .from('search_logs')
        .select('query')
        .order('searched_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        throw error
      }

      return (data ?? []) as unknown as SearchLogQueryRow[]
    }),
    fetchAllSearchLogPages<SearchLogDateRow>(async (offset, limit) => {
      const { data, error } = await supabaseAdmin
        .from('search_logs')
        .select('searched_at')
        .gte('searched_at', dailyWindowStart)
        .order('searched_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        throw error
      }

      return (data ?? []) as unknown as SearchLogDateRow[]
    }),
  ])

  const queryCounts = new Map<string, number>()
  for (const row of topQueryRows) {
    if (!row.query) continue
    const nextCount = (queryCounts.get(row.query) ?? 0) + 1
    queryCounts.set(row.query, nextCount)
  }

  const dailyCountsMap = new Map<string, number>()
  for (const row of dailyRows) {
    if (!row.searched_at) {
      continue
    }

    const date = formatTokyoDate(row.searched_at)
    dailyCountsMap.set(date, (dailyCountsMap.get(date) ?? 0) + 1)
  }

  return {
    topQueries: [...queryCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja'))
      .slice(0, 20)
      .map(([query, count]) => ({ query, count })),
    dailyCounts: [...dailyCountsMap.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, count]) => ({ date, count })),
  }
}

export async function searchAdminStreams(input: AdminStreamSearchInput): Promise<AdminListStream[]> {
  await requireRole(['admin'])

  const normalized = input.query?.trim() ?? ''
  const startDate = input.startDate?.trim() ?? ''
  const endDate = input.endDate?.trim() ?? ''
  const limit = input.limit ?? 20

  if (!normalized && !startDate && !endDate) {
    return []
  }

  let query = supabaseAdmin
    .from('streams')
    .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed, needs_manual_review')
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
  await requireRole(['admin'])

  const { data, error } = await supabaseAdmin
    .from('streams')
    .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed, needs_manual_review')
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
  await requireRole(['admin'])

  let payload: Record<string, unknown> | null = null
  if (input.kind === 'fetch_new') {
    payload = { days: input.days ?? 30, max_videos: input.maxVideos ?? 20 }
  } else if (input.kind === 'weekly_magazine' && input.date) {
    payload = { date: input.date }
  }

  const row = {
    kind: input.kind,
    video_id: input.kind === 'reprocess_single' ? input.videoId : null,
    payload,
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
  await requireRole(['admin'])

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

  return (data ?? []) as unknown as PipelineJob[]
}

export async function cancelPipelineJob(jobId: string): Promise<void> {
  await requireRole(['admin'])

  const { error } = await (supabaseAdmin as never as {
    from: (table: 'pipeline_jobs') => {
      update: (value: { status: 'cancelled' }) => {
        eq: (column: 'id', value: string) => {
          eq: (column: 'status', value: 'pending') => Promise<{ error: unknown }>
        }
      }
    }
  })
    .from('pipeline_jobs')
    .update({ status: 'cancelled' })
    .eq('id', jobId)
    .eq('status', 'pending')

  if (error) {
    throw error
  }

  revalidatePath('/admin')
}

export async function deletePipelineJob(jobId: string): Promise<void> {
  await requireRole(['admin'])

  const { error } = await supabaseAdmin
    .from('pipeline_jobs' as never)
    .delete()
    .eq('id' as never, jobId)

  if (error) throw error
  revalidatePath('/admin')
}

export async function clearFinishedJobs(): Promise<void> {
  await requireRole(['admin'])

  const { error } = await supabaseAdmin
    .from('pipeline_jobs' as never)
    .delete()
    .in('status' as never, ['done', 'cancelled', 'failed'])

  if (error) throw error
  revalidatePath('/admin')
}

export async function setAdminStreamReviewed(videoId: string, isReviewed: boolean): Promise<AdminListStream> {
  await requireRole(['admin'])

  const { data, error } = await supabaseAdmin
    .from('streams')
    .update({ is_reviewed: isReviewed } as never)
    .eq('video_id', videoId)
    .select('id, video_id, title, stream_date, status, thumbnail_url, is_reviewed, needs_manual_review')
    .single()

  if (error) {
    throw error
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/stream/${videoId}`)

  return data
}

export async function fetchAdminStream(videoId: string): Promise<AdminEditableStream | null> {
  await requireRole(['admin'])

  const withLiveViewing = await supabaseAdmin
    .from('streams')
    .select(ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING)
    .eq('video_id', videoId)
    .maybeSingle()

  if (!withLiveViewing.error) {
    return withLiveViewing.data
      ? toEditableStream({ ...(withLiveViewing.data as unknown as AdminEditableStream), supportsLiveViewing: true })
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

export async function fetchAdminTagVocabulary(): Promise<AdminTagVocabularyEntry[]> {
  await requireRole(['admin'])

  const { data, error } = await supabaseAdmin
    .from('tag_vocabulary')
    .select('slug, label, is_active, sort_order')
    .order('sort_order', { ascending: true })
    .order('slug', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as AdminTagVocabularyEntry[]
}

export async function fetchAdminChapters(videoId: string): Promise<AdminChapter[]> {
  await requireRole(['admin'])

  const streamId = await findStreamIdByVideoId(videoId)

  if (!streamId) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('chapters')
    .select('id, start_sec, end_sec, title, summary, sort_order')
    .eq('stream_id', streamId)
    .order('sort_order', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as unknown as AdminChapter[]
}

export async function updateAdminStream(input: UpdateAdminStreamInput): Promise<UpdateAdminStreamResult> {
  await requireRole(['admin'])

  const [existingStreamResult, vocabularyResult] = await Promise.all([
    supabaseAdmin
      .from('streams')
      .select('tags')
      .eq('video_id', input.videoId)
      .maybeSingle(),
    supabaseAdmin
      .from('tag_vocabulary')
      .select('slug, label, is_active, sort_order')
      .order('sort_order', { ascending: true })
      .order('slug', { ascending: true }),
  ])

  if (existingStreamResult.error) {
    throw existingStreamResult.error
  }
  if (!existingStreamResult.data) {
    throw new Error(`stream not found: ${input.videoId}`)
  }
  if (vocabularyResult.error) {
    throw vocabularyResult.error
  }

  const tagUpdate = resolveAdminTagUpdate(
    (existingStreamResult.data as Pick<Stream, 'tags'>).tags,
    input.tags,
    (vocabularyResult.data ?? []) as AdminTagVocabularyEntry[],
  )

  logAdminTagUpdateDrops(tagUpdate, input.videoId)

  const updates: AdminStreamUpdate = {
    summary: input.summary.trim() || null,
    corner_names: normalizeCsv(input.cornerNames),
    guests: normalizeCsv(input.guests),
    songs: normalizeCsv(input.songs),
    has_live_singing: input.hasLiveSinging,
    highlights: input.highlights.length > 0 ? input.highlights : null,
    has_live_viewing: input.hasLiveViewing,
    talk_topics: normalizeCsv(input.talkTopics),
    is_reviewed: input.isReviewed,
  }
  if (tagUpdate.shouldUpdate) {
    updates.tags = tagUpdate.storageValue ?? null
  }

  const withLiveViewing = await supabaseAdmin
    .from('streams')
    .update(updates as never)
    .eq('video_id', input.videoId)
    .select(ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING)
    .single()

  let data: AdminEditableStream

  if (!withLiveViewing.error) {
    data = toEditableStream({ ...(withLiveViewing.data as unknown as AdminEditableStream), supportsLiveViewing: true })
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
  revalidatePath(`/stream/${input.videoId}`)

  return {
    ok: true,
    stream: data,
    droppedInvalidTags: tagUpdate.droppedInvalidTags,
    droppedInactiveTags: tagUpdate.droppedInactiveTags,
  }
}

export async function saveAdminChapters(input: SaveAdminChaptersInput): Promise<void> {
  await requireRole(['admin'])

  const streamId = await findStreamIdByVideoId(input.videoId)

  if (!streamId) {
    throw new Error(`stream not found: ${input.videoId}`)
  }

  const deleteResult = await supabaseAdmin
    .from('chapters')
    .delete()
    .eq('stream_id', streamId)

  if (deleteResult.error) {
    throw deleteResult.error
  }

  if (input.chapters.length > 0) {
    const rows: ChapterInsert[] = input.chapters.map((chapter, index) => ({
      stream_id: streamId,
      start_sec: chapter.start_sec,
      end_sec: chapter.end_sec,
      title: chapter.title.trim(),
      summary: chapter.summary?.trim() || null,
      transcript_segment: null,
      sort_order: index,
    }))

    const { error } = await supabaseAdmin
      .from('chapters' as never)
      .insert(rows as never)

    if (error) {
      throw error
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/stream/${input.videoId}`)
  revalidatePath(`/stream/${input.videoId}`)
}

// ── Entity management ────────────────────────────────────────────────────────

export type AdminEntity = {
  id: string
  slug: string
  name: string
  match_names: string[]
  category: string
  role: string | null
  description: string
  related_work: string | null
  external_url: string | null
  sort_order: number | null
  created_at: string
  updated_at: string
}

export type AdminEntityStream = {
  id: string
  video_id: string
  title: string
  stream_date: string
}

export type UpsertAdminEntityInput = {
  id?: string
  name: string
  slug: string
  category: string
  role: string
  description: string
  matchNames: string[]
  relatedWork: string
  externalUrl: string
  sortOrder: string
}

export type SuggestEntityResult = {
  slug: string
  category: string
  role: string
  description: string
  matchNames: string[]
  relatedWork: string
  externalUrl: string
}

const ENTITY_CATEGORIES = ['family', 'celebrity', 'remixer', 'team', 'craftsman', 'product', 'project'] as const

function createEmptySuggestEntityResult(): SuggestEntityResult {
  return {
    slug: '',
    category: '',
    role: '',
    description: '',
    matchNames: [],
    relatedWork: '',
    externalUrl: '',
  }
}

function readTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isEntityCategory(value: string): value is (typeof ENTITY_CATEGORIES)[number] {
  return (ENTITY_CATEGORIES as readonly string[]).includes(value)
}

function parseSuggestEntityResult(content: string): SuggestEntityResult | null {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  try {
    const parsed = JSON.parse(normalized)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const matchNames = Array.isArray(parsed.matchNames)
      ? parsed.matchNames.flatMap((value: unknown) => {
        const normalizedValue = readTrimmedString(value)
        return normalizedValue ? [normalizedValue] : []
      })
      : []

    const category = readTrimmedString(parsed.category)

    return {
      slug: readTrimmedString(parsed.slug),
      category: isEntityCategory(category) ? category : 'celebrity',
      role: readTrimmedString(parsed.role),
      description: readTrimmedString(parsed.description),
      matchNames: [...new Set(matchNames)] as string[],
      relatedWork: readTrimmedString(parsed.relatedWork),
      externalUrl: readTrimmedString(parsed.externalUrl),
    }
  } catch {
    return null
  }
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: {
    blockReason?: string
  }
}

type CallGeminiJsonOptions = {
  systemInstruction: string
  prompt: string
  temperature: number
  maxOutputTokens: number
}

const GEMINI_GENERATE_CONTENT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const GEMINI_TIMEOUT_MS = 20_000

function geminiHttpErrorMessage(status: number, details: string) {
  if (status === 429) {
    const normalizedDetails = details.toLowerCase()
    const monthlySpendTerms = [
      'monthly spend cap',
      'monthly usage cap',
      'billing account tier spend cap',
      'start of the next billing cycle',
      'next billing cycle',
      'project-level spend cap',
      'spend cap',
      'prepay credit balance',
      'credit balance',
      'no credits',
    ]
    const perMinuteTerms = [
      'per minute',
      'per-minute',
      'per_minute',
      'perminute',
      'rpm',
      'tpm',
      'requestsperminute',
      'tokensperminute',
      'request limit per minute',
      'token limit per minute',
    ]

    if (monthlySpendTerms.some((term) => normalizedDetails.includes(term))) {
      return 'Gemini APIの月間利用上限に達しています。利用状況を確認してください。'
    }

    if (perMinuteTerms.some((term) => normalizedDetails.includes(term))) {
      return 'Gemini APIが混み合っています。時間をおいて再試行してください。'
    }

    return 'Gemini APIの利用上限に達しているか、混み合っています。時間をおいて再試行してください。'
  }

  if (status === 401 || status === 403) {
    return 'Gemini APIの認証に失敗しました。設定を確認してください。'
  }

  if (status >= 500) {
    return 'Gemini APIで一時的な障害が発生しています。時間をおいて再試行してください。'
  }

  return `Gemini APIリクエストに失敗しました（HTTP ${status}）。`
}

async function callGeminiJson({
  systemInstruction,
  prompt,
  temperature,
  maxOutputTokens,
}: CallGeminiJsonOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const response = await fetch(GEMINI_GENERATE_CONTENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    })

    if (!response.ok) {
      const details = await response.text().catch(() => '')
      throw new Error(geminiHttpErrorMessage(response.status, details))
    }

    let payload: GeminiGenerateContentResponse
    try {
      payload = await response.json() as GeminiGenerateContentResponse
    } catch {
      throw new Error('Gemini APIの応答形式が不正です。')
    }
    const blockReason = payload.promptFeedback?.blockReason
    if (blockReason) {
      throw new Error('Gemini APIが入力をブロックしました。入力内容を確認してください。')
    }

    const candidate = payload.candidates?.[0]
    const finishReason = candidate?.finishReason
    if (finishReason && finishReason !== 'STOP') {
      throw new Error(`Gemini APIが応答を完了できませんでした（${finishReason}）。`)
    }

    const content = candidate?.content?.parts?.[0]?.text
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Gemini APIから有効な応答を受け取れませんでした。')
    }

    return content
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Gemini APIの応答がタイムアウトしました。時間をおいて再試行してください。')
    }

    if (error instanceof Error) {
      throw error
    }

    throw new Error('Gemini APIへの接続に失敗しました。時間をおいて再試行してください。')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchAdminEntities(): Promise<AdminEntity[]> {
  await requireRole(['admin'])
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select(ADMIN_ENTITY_SELECT)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as AdminEntity[]
}

export async function fetchAdminEntity(id: string): Promise<AdminEntity | null> {
  await requireRole(['admin'])
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select(ADMIN_ENTITY_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as unknown as AdminEntity | null
}

export async function fetchAdminEntityStreams(entityId: string): Promise<AdminEntityStream[]> {
  await requireRole(['admin'])
  const { data: relations, error: relErr } = await supabaseAdmin
    .from('stream_entities')
    .select('stream_id')
    .eq('entity_id', entityId)
  if (relErr) throw relErr
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = (relations ?? []).map((r: any) => r.stream_id)
  if (ids.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from('streams')
    .select('id, video_id, title, stream_date')
    .in('id', ids)
    .order('stream_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as AdminEntityStream[]
}

export async function upsertAdminEntity(input: UpsertAdminEntityInput): Promise<AdminEntity> {
  await requireRole(['admin'])
  const payload = {
    name: input.name.trim(),
    slug: input.slug.trim(),
    category: input.category,
    role: input.role.trim() || null,
    description: input.description.trim(),
    match_names: input.matchNames,
    related_work: input.relatedWork.trim() || null,
    external_url: input.externalUrl.trim() || null,
    sort_order: input.sortOrder !== '' ? Number(input.sortOrder) : null,
  }
  let result
  if (input.id) {
    result = await supabaseAdmin
      .from('entities')
      .update(payload as never)
      .eq('id', input.id)
      .select(ADMIN_ENTITY_SELECT)
      .single()
  } else {
    result = await supabaseAdmin
      .from('entities')
      .insert(payload as never)
      .select(ADMIN_ENTITY_SELECT)
      .single()
  }
  if (result.error) throw result.error
  revalidatePath('/admin/entity')
  revalidatePath('/entity')
  return result.data as unknown as AdminEntity
}

export async function deleteAdminEntity(id: string): Promise<void> {
  await requireRole(['admin'])
  const { error } = await supabaseAdmin.from('entities').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/admin/entity')
  revalidatePath('/entity')
}

export async function suggestEntityFields(name: string): Promise<SuggestEntityResult> {
  await requireRole(['admin'])

  const normalizedName = name.trim()
  if (!normalizedName) {
    return createEmptySuggestEntityResult()
  }

  const content = await callGeminiJson({
    systemInstruction: 'あなたはサカナクション・山口一郎の音楽活動に詳しいアシスタントです。JSON以外は出力しないでください。',
    prompt: `「${normalizedName}」というエンティティについて以下フィールドを推測してJSONで返してください。

カテゴリ候補（いずれか1つ）:
- family: 家族・地元関係者
- celebrity: 交友・影響を受けたアーティスト
- remixer: リミキサー
- team: チームメンバー
- craftsman: 職人・技術者
- product: コラボ製品
- project: プロジェクト

出力形式（JSONのみ）:
{
  "slug": "url-safe（ローマ字またはASCII、ハイフン区切り）",
  "category": "上記カテゴリのいずれか",
  "role": "具体的な役割・肩書き（例：ベーシスト）",
  "description": "日本語の説明文（2〜3文）",
  "matchNames": ["表記ゆれ・別名"],
  "relatedWork": "関連作品（あれば）",
  "externalUrl": "公式URL（あれば、なければ空文字）"
}
不明なフィールドは空文字または空配列にしてください。`,
    temperature: 0.3,
    maxOutputTokens: 1024,
  })

  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  try {
    JSON.parse(normalized)
  } catch {
    throw new Error('Gemini APIの応答をJSONとして解析できませんでした。')
  }

  const parsed = parseSuggestEntityResult(content)
  if (!parsed) {
    throw new Error('Gemini APIの応答形式が不正です。')
  }

  return parsed
}

export async function markStreamReviewed(videoId: string): Promise<AdminEditableStream> {
  await requireRole(['admin'])

  const updates: StreamUpdate = { is_reviewed: true }

  const withLiveViewing = await supabaseAdmin
    .from('streams')
    .update(updates as never)
    .eq('video_id', videoId)
    .select(ADMIN_STREAM_SELECT_WITH_LIVE_VIEWING)
    .single()

  let data: AdminEditableStream

  if (!withLiveViewing.error) {
    data = toEditableStream({ ...(withLiveViewing.data as unknown as AdminEditableStream), supportsLiveViewing: true })
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

export type ScrutinyEntity = {
  name: string
  category: string
  status: 'found' | 'not_found'
}

export type ScrutinyResult = {
  entities: ScrutinyEntity[]
}

type RawScrutinyEntity = {
  name?: unknown
  category?: unknown
}

function parseScrutinyEntities(content: string) {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  try {
    const parsed = JSON.parse(normalized)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return []
      }

      const { name, category } = item as RawScrutinyEntity
      if (typeof name !== 'string' || typeof category !== 'string') {
        return []
      }

      const trimmedName = name.trim()
      const trimmedCategory = category.trim()

      if (!trimmedName || !trimmedCategory) {
        return []
      }

      return [{ name: trimmedName, category: trimmedCategory }]
    })
  } catch {
    return []
  }
}

export async function scrutinizeStreamSummary(videoId: string): Promise<ScrutinyResult> {
  await requireRole(['admin'])

  const { data, error } = await (supabaseAdmin as never as {
    from: (table: 'streams') => {
      select: (columns: 'summary') => {
        eq: (column: 'video_id', value: string) => {
          maybeSingle: () => Promise<{ data: Pick<Stream, 'summary'> | null; error: unknown }>
        }
      }
    }
  })
    .from('streams')
    .select('summary')
    .eq('video_id', videoId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const summary = data?.summary?.trim() ?? ''
  if (!summary) {
    return { entities: [] }
  }

  const content = await callGeminiJson({
    systemInstruction: 'あなたはNERの専門家です。JSON配列のみ出力してください。',
    prompt: `以下はサカナクション 山口一郎のライブ配信要約です。固有名詞（曲名・人名・アーティスト名・イベント名・会場名）を全て抽出してJSON配列で返してください。\n\n要約:\n${summary}\n\n出力形式（JSONのみ）:\n[{"name": "固有名詞", "category": "song|person|event|venue|other"}]`,
    temperature: 0,
    maxOutputTokens: 2048,
  })

  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  let rawEntities: unknown
  try {
    rawEntities = JSON.parse(normalized)
  } catch {
    throw new Error('Gemini APIの応答をJSONとして解析できませんでした。')
  }

  if (!Array.isArray(rawEntities)) {
    throw new Error('Gemini APIの応答形式が不正です。')
  }

  const parsedEntities = parseScrutinyEntities(content)

  if (parsedEntities.length === 0) {
    return { entities: [] }
  }

  const entities = await Promise.all(
    parsedEntities.map(async (entity): Promise<ScrutinyEntity> => {
      const { data: matched, error: matchError } = await supabaseAdmin
        .from('entities')
        .select('name')
        .ilike('name', entity.name)
        .limit(1)

      if (matchError) {
        throw matchError
      }

      return {
        name: entity.name,
        category: entity.category,
        status: (matched?.length ?? 0) > 0 ? 'found' : 'not_found',
      }
    })
  )

  return { entities }
}

type AdminBookmarkRow = {
  streams: {
    id: string
    video_id: string
    title: string
    stream_date: string
  } | { id: string; video_id: string; title: string; stream_date: string }[] | null
}

export async function fetchAdminBookmarks() {
  const { user } = await requireRole(['admin'])

  const { data, error } = await supabaseAdmin
    .from('bookmarks')
    .select('streams(id, video_id, title, stream_date)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`admin bookmarks fetch failed: ${error.message}`)
  }

  return ((data ?? []) as unknown as AdminBookmarkRow[]).flatMap((row) => {
    const stream = Array.isArray(row.streams) ? row.streams[0] : row.streams
    return stream ? [stream] : []
  })
}

export async function removeAdminBookmark(streamId: string) {
  const { user } = await requireRole(['admin'])
  const { error } = await supabaseAdmin
    .from('bookmarks')
    .delete()
    .eq('user_id', user.id)
    .eq('stream_id', streamId)
  if (error) throw new Error(`bookmark remove failed: ${error.message}`)
}
