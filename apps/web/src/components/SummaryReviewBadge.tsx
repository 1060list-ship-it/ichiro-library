import type { SummaryReviewStatus } from '@/lib/types'

export default function SummaryReviewBadge({ status }: { status: SummaryReviewStatus | null | undefined }) {
  if (status === 'legacy_unreviewed' || status === 'confirmed') return null
  const extra = status === 'needs_review' ? '・要確認箇所' : status === 'review_failed' ? '・校閲要再実行' : ''
  return <span className="inline-block rounded border border-amber-600 px-2 py-0.5 text-xs text-amber-700">要約確認前{extra}</span>
}

export function SummaryReviewDetail({ review, error, loading }: { review: import('@/app/admin/summary-review-actions').ReviewDetail; error: string; loading: boolean }) {
  return <div className="space-y-2 text-sm text-gray-300" aria-label="自動校閲の詳細">
    <h3 className="font-semibold">自動校閲</h3>
    {loading ? <p>校閲情報を取得中です。</p> : error ? <p>{error}</p> : !review ? <p>校閲結果はありません。</p> : !review.current ? <p>この校閲結果は現在の内容に対応していません（状態: {review.state}）。</p> : review.state === 'failed' ? <p>校閲に失敗しました。</p> : <>
      <p>状態: {review.state}</p>
      {review.state === 'succeeded' && review.findings.length === 0 && <p>指摘はありません。</p>}
      {review.findings.map((finding) => <div key={finding.finding_no} className="rounded border border-gray-700 p-3"><p>変更前: {finding.before_text}</p><p>変更後: {finding.after_text}</p><p>根拠: {finding.evidence}</p><p>確度: {finding.confidence}</p></div>)}
    </>}
  </div>
}
