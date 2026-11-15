'use server'

import { requireRole } from '@/lib/auth'

export type ReviewFinding = {
  finding_no: number
  before_text: string
  after_text: string
  evidence: string
  confidence: string
}
export type ReviewDetail = {
  state: string
  current: boolean
  findings: ReviewFinding[]
} | null

function safeVersion(value: unknown): number | null {
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function fetchSummaryReview(videoId: string): Promise<ReviewDetail> {
  await requireRole(['admin'])
  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    // The review tables are intentionally absent from the public Database type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any
    const streamResult = await db.from('streams').select('id,summary,transcript,is_reviewed,summary_review_status,summary_review_version').eq('video_id', videoId).maybeSingle()
    if (streamResult.error || !streamResult.data) throw new Error('lookup failed')
    const stream = streamResult.data
    const runResult = await db.from('summary_review_runs').select('review_run_id,stream_id,state,input_version,input_summary,input_transcript,result_payload,created_at').eq('stream_id', stream.id).order('created_at', { ascending: false }).order('review_run_id', { ascending: false }).limit(1).maybeSingle()
    if (runResult.error) throw new Error('lookup failed')
    const run = runResult.data
    if (!run) return null
    const payload = run.result_payload
    const inputVersion = safeVersion(run.input_version)
    const version = safeVersion(stream.summary_review_version)
    const versionValid = inputVersion !== null && version !== null
    const unfinished = run.state === 'pending' || run.state === 'running'
    const current = versionValid && !stream.is_reviewed && run.input_transcript === stream.transcript && (
      unfinished
        ? version === inputVersion && run.input_summary === stream.summary && stream.summary_review_status === 'pending'
        : (run.state === 'succeeded' || run.state === 'failed') && payload && typeof payload.summary === 'string' && typeof run.input_summary === 'string' && version === inputVersion! + (payload.summary === run.input_summary ? 0 : 1) && payload.summary === stream.summary && payload.status === stream.summary_review_status
    ) && run.state !== 'stale'
    if (!current) return { state: run.state, current: false, findings: [] }
    const logs = await db.from('summary_review_log').select('finding_no,before_text,after_text,evidence,confidence').eq('stream_id', stream.id).eq('review_run_id', run.review_run_id).order('finding_no', { ascending: true })
    if (logs.error) throw new Error('lookup failed')
    return { state: run.state, current: true, findings: logs.data ?? [] }
  } catch {
    throw new Error('校閲情報を取得できませんでした。')
  }
}
