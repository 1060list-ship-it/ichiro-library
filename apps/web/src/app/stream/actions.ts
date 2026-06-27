'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'

const REPORT_THRESHOLD = 5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any

export async function reportStreamSummary(
  videoId: string,
  userAgent: string,
): Promise<{ ok: boolean }> {
  // 1. 報告を記録
  const { error: insertErr } = await db
    .from('stream_reports')
    .insert({ video_id: videoId, user_agent: userAgent })

  if (insertErr) {
    console.error('[reportStreamSummary] insert error', insertErr)
    return { ok: false }
  }

  // 2. 配信の現状を取得
  const { data: stream } = await db
    .from('streams')
    .select('auto_reprocessed_at, needs_manual_review')
    .eq('video_id', videoId)
    .single() as { data: { auto_reprocessed_at: string | null; needs_manual_review: boolean } | null }

  if (!stream || stream.needs_manual_review) return { ok: true }

  // 3. 閾値判定用カウント（直近の再処理以降のみ）
  let countQuery = db
    .from('stream_reports')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', videoId)

  if (stream.auto_reprocessed_at) {
    countQuery = countQuery.gte('reported_at', stream.auto_reprocessed_at)
  }

  const { count } = await countQuery as { count: number | null }

  if ((count ?? 0) <= REPORT_THRESHOLD) return { ok: true }

  if (!stream.auto_reprocessed_at) {
    // 初回閾値超え → 自動再処理をキューに積む
    await db
      .from('pipeline_jobs')
      .insert({ kind: 'reprocess_single', video_id: videoId, payload: null })

    await db
      .from('streams')
      .update({ auto_reprocessed_at: new Date().toISOString() })
      .eq('video_id', videoId)
  } else {
    // 2回目閾値超え → 手動レビューフラグを立てる
    await db
      .from('streams')
      .update({ needs_manual_review: true })
      .eq('video_id', videoId)
  }

  return { ok: true }
}
