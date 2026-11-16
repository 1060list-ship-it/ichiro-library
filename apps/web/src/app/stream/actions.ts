'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'

const REPORT_THRESHOLD = 5

// 未認証で呼べるエンドポイントのため、同一動画への報告を時間窓で上限制限する。
// 上限は閾値判定（6件）より広く取り、正常な報告フローを壊さない範囲でスパムを抑える。
const REPORT_WINDOW_HOURS = 1
const REPORT_MAX_PER_WINDOW = 10
const VIDEO_ID_MAX_LENGTH = 64
const USER_AGENT_MAX_LENGTH = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any

export async function reportStreamSummary(
  videoId: string,
  userAgent: string,
): Promise<{ ok: boolean }> {
  const normalizedVideoId = videoId.trim().slice(0, VIDEO_ID_MAX_LENGTH)
  const normalizedUserAgent = userAgent.trim().slice(0, USER_AGENT_MAX_LENGTH)

  if (!normalizedVideoId) {
    return { ok: false }
  }

  // 0. 時間窓あたりの報告数を確認し、上限超過分は黙って破棄する
  const windowStart = new Date(Date.now() - REPORT_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { count: recentCount, error: recentCountErr } = await db
    .from('stream_reports')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', normalizedVideoId)
    .gte('reported_at', windowStart)

  if (recentCountErr) {
    // 上限確認の失敗はフェイルオープン（後続のinsert失敗時にok:falseへ落ちる）
    console.error('[reportStreamSummary] rate limit count error', recentCountErr)
  } else if ((recentCount ?? 0) >= REPORT_MAX_PER_WINDOW) {
    // ok を返して制限の存在を学習させない
    return { ok: true }
  }

  // 1. 報告を記録
  const { error: insertErr } = await db
    .from('stream_reports')
    .insert({ video_id: normalizedVideoId, user_agent: normalizedUserAgent })

  if (insertErr) {
    console.error('[reportStreamSummary] insert error', insertErr)
    return { ok: false }
  }

  // 2. 配信の現状を取得
  const { data: stream } = await db
    .from('streams')
    .select('auto_reprocessed_at, needs_manual_review')
    .eq('video_id', normalizedVideoId)
    .single() as { data: { auto_reprocessed_at: string | null; needs_manual_review: boolean } | null }

  if (!stream || stream.needs_manual_review) return { ok: true }

  // 3. 閾値判定用カウント（直近の再処理以降のみ）
  let countQuery = db
    .from('stream_reports')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', normalizedVideoId)

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
      .eq('video_id', normalizedVideoId)
  } else {
    // 2回目閾値超え → 手動レビューフラグを立てる
    await db
      .from('streams')
      .update({ needs_manual_review: true })
      .eq('video_id', normalizedVideoId)
  }

  return { ok: true }
}
