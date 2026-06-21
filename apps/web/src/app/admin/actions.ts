'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { requireRole } from '@/lib/auth'
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
  await requireRole(['admin'])

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

  return (data ?? []) as PipelineJob[]
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
  await requireRole(['admin'])

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
  await requireRole(['admin'])

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

export async function fetchAdminEntities(): Promise<AdminEntity[]> {
  await requireRole(['admin'])
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as AdminEntity[]
}

export async function fetchAdminEntity(id: string): Promise<AdminEntity | null> {
  await requireRole(['admin'])
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as AdminEntity | null
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
  return (data ?? []) as AdminEntityStream[]
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
      .select('*')
      .single()
  } else {
    result = await supabaseAdmin
      .from('entities')
      .insert(payload as never)
      .select('*')
      .single()
  }
  if (result.error) throw result.error
  revalidatePath('/admin/entity')
  revalidatePath('/entity')
  return result.data as AdminEntity
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

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return createEmptySuggestEntityResult()
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'あなたはサカナクション・山口一郎の音楽活動に詳しいアシスタントです。JSON以外は出力しないでください。',
          },
          {
            role: 'user',
            content: `「${normalizedName}」というエンティティについて以下フィールドを推測してJSONで返してください。

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
          },
        ],
      }),
    })

    if (!response.ok) {
      return createEmptySuggestEntityResult()
    }

    const payload = await response.json() as OpenAIChatCompletionResponse
    const content = extractScrutinyContent(payload.choices?.[0]?.message?.content)

    return parseSuggestEntityResult(content) ?? createEmptySuggestEntityResult()
  } catch {
    return createEmptySuggestEntityResult()
  }
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

export type ScrutinyEntity = {
  name: string
  category: string
  status: 'found' | 'not_found'
}

export type ScrutinyResult = {
  entities: ScrutinyEntity[]
}

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null
    } | null
  }>
}

type RawScrutinyEntity = {
  name?: unknown
  category?: unknown
}

function extractScrutinyContent(content: string | Array<{ type?: string; text?: string }> | null | undefined) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }

  return ''
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

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return { entities: [] }
  }

  let parsedEntities: Array<{ name: string; category: string }> = []

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'あなたはNERの専門家です。JSON配列のみ出力してください。',
          },
          {
            role: 'user',
            content: `以下はサカナクション 山口一郎のライブ配信要約です。固有名詞（曲名・人名・アーティスト名・イベント名・会場名）を全て抽出してJSON配列で返してください。\n\n要約:\n${summary}\n\n出力形式（JSONのみ）:\n[{"name": "固有名詞", "category": "song|person|event|venue|other"}]`,
          },
        ],
      }),
    })

    if (!response.ok) {
      return { entities: [] }
    }

    const payload = await response.json() as OpenAIChatCompletionResponse
    const content = extractScrutinyContent(payload.choices?.[0]?.message?.content)
    parsedEntities = parseScrutinyEntities(content)
  } catch {
    return { entities: [] }
  }

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
