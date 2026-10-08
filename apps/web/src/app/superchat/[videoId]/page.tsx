import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type RankingRow = {
  author_channel_id: string
  author_name: string
  event_count: number
  total_jpy: number
}

type PageProps = {
  params: Promise<{ videoId: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { videoId } = await params
  return { title: `スパチャランキング ${videoId} | ichiro library` }
}

export default async function SuperchatVideoPage({ params }: PageProps) {
  const { videoId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: stream } = await supabase
    .from('streams')
    .select('video_id,title,stream_date')
    .eq('video_id', videoId)
    .maybeSingle()

  const [byAmountRes, byCountRes] = await Promise.all([
    supabase.rpc('superchat_ranking_by_video', { target_video_id: videoId, sort_by: 'amount', limit_n: 30 }),
    supabase.rpc('superchat_ranking_by_video', { target_video_id: videoId, sort_by: 'count', limit_n: 30 }),
  ])

  if (byAmountRes.error) throw new Error(`ranking fetch failed: ${byAmountRes.error.message}`)
  if (byCountRes.error) throw new Error(`ranking fetch failed: ${byCountRes.error.message}`)

  const byAmount = (byAmountRes.data ?? []) as RankingRow[]
  const byCount = (byCountRes.data ?? []) as RankingRow[]
  const total = byAmount.reduce((sum, stat) => sum + Number(stat.total_jpy), 0)
  const events = byAmount.reduce((sum, stat) => sum + Number(stat.event_count), 0)

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12 text-gray-100">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/superchat"
          className="inline-flex items-center text-sm text-gray-400 transition hover:text-white"
        >
          ← ランキングへ戻る
        </Link>

        <header className="mt-8 space-y-3 border-b border-white/10 pb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {stream?.title ?? videoId}
          </h1>
          <p className="text-sm text-gray-400">
            {stream?.stream_date ?? ''} / {events.toLocaleString()}件 /
            合計 ¥{total.toLocaleString()}
          </p>
          {stream && (
            <p className="text-sm">
              <Link
                href={`/stream/${stream.video_id}`}
                className="text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 hover:text-white"
              >
                配信ページを見る →
              </Link>
            </p>
          )}
        </header>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold text-white">金額ランキング</h2>
          <ol className="space-y-2">
            {byAmount.map((stat, index) => (
              <li
                key={stat.author_channel_id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <span className="w-8 shrink-0 font-mono text-gray-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-white">{stat.author_name}</span>
                <span className="shrink-0 font-mono text-gray-300">¥{Number(stat.total_jpy).toLocaleString()}</span>
                <span className="shrink-0 text-gray-400">{stat.event_count}回</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-white">回数ランキング</h2>
          <ol className="space-y-2">
            {byCount.map((stat, index) => (
              <li
                key={stat.author_channel_id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <span className="w-8 shrink-0 font-mono text-gray-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-white">{stat.author_name}</span>
                <span className="shrink-0 text-gray-300">{stat.event_count}回</span>
                <span className="shrink-0 font-mono text-gray-400">¥{Number(stat.total_jpy).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  )
}
