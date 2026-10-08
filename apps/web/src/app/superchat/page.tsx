import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type RankingRow = {
  author_channel_id: string
  author_name: string
  event_count: number
  total_jpy: number
}

type VideoStat = {
  video_id: string
  event_count: number
  author_count: number
  total_jpy: number
}

export const metadata = {
  title: 'スパチャランキング | ichiro library',
}

function RankingList({ rows }: { rows: RankingRow[] }) {
  return (
    <ol className="space-y-2">
      {rows.map((stat, index) => (
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
  )
}

export default async function SuperchatPage() {
  const supabase = await createSupabaseServerClient()

  const [byAmountRes, byCountRes, videosRes] = await Promise.all([
    supabase.rpc('superchat_ranking_all', { sort_by: 'amount', limit_n: 30 }),
    supabase.rpc('superchat_ranking_all', { sort_by: 'count', limit_n: 30 }),
    supabase.rpc('superchat_video_stats'),
  ])

  if (byAmountRes.error) throw new Error(`ranking fetch failed: ${byAmountRes.error.message}`)
  if (byCountRes.error) throw new Error(`ranking fetch failed: ${byCountRes.error.message}`)
  if (videosRes.error) throw new Error(`video stats fetch failed: ${videosRes.error.message}`)

  const videos = (videosRes.data ?? []) as VideoStat[]
  const videoIds = videos.map((v) => v.video_id)
  const { data: streams } = videoIds.length > 0
    ? await supabase.from('streams').select('video_id,title,stream_date').in('video_id', videoIds)
    : { data: [] }
  const titleByVideoId = new Map(
    ((streams ?? []) as { video_id: string; title: string; stream_date: string }[]).map((s) => [s.video_id, s]),
  )

  const grandTotal = videos.reduce((sum, v) => sum + Number(v.total_jpy), 0)
  const grandEvents = videos.reduce((sum, v) => sum + Number(v.event_count), 0)

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12 text-gray-100">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-400 transition hover:text-white"
        >
          ← トップへ戻る
        </Link>

        <header className="mt-8 space-y-3 border-b border-white/10 pb-8">
          <p className="text-sm uppercase tracking-[0.24em] text-gray-500">
            Superchat Ranking
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            スパチャランキング
          </h1>
          <p className="text-sm text-gray-400">
            {videos.length}本の配信 / {grandEvents.toLocaleString()}件 / 合計
            ¥{grandTotal.toLocaleString()} (JPYのみ集計・順次拡大中)
          </p>
        </header>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold text-white">金額ランキング(累計)</h2>
          <RankingList rows={(byAmountRes.data ?? []) as RankingRow[]} />
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-white">回数ランキング(累計)</h2>
          <RankingList rows={(byCountRes.data ?? []) as RankingRow[]} />
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-white">対象配信</h2>
          <ul className="space-y-2">
            {videos.map((video) => {
              const stream = titleByVideoId.get(video.video_id)
              return (
                <li
                  key={video.video_id}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/superchat/${video.video_id}`}
                      className="block truncate text-white hover:underline"
                    >
                      {stream?.title ?? video.video_id}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {stream?.stream_date ?? ''} / {video.event_count}件 /
                      ¥{Number(video.total_jpy).toLocaleString()}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </main>
  )
}
