import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// 試作: 2023-05-29 の1本分のみ
const PROTOTYPE_VIDEO_ID = 'Ya-fczXJAiI'

type SuperchatRow = {
  author_channel_id: string
  author_name: string
  amount_value: number
  currency: string
  kind: string
}

type AuthorStat = {
  channelId: string
  name: string
  count: number
  total: number
}

export const metadata = {
  title: 'スパチャランキング(試作) | ichiro library',
}

export default async function SuperchatPage() {
  const supabase = await createSupabaseServerClient()

  const { data: stream } = await supabase
    .from('streams')
    .select('video_id,title,stream_date')
    .eq('video_id', PROTOTYPE_VIDEO_ID)
    .maybeSingle()

  const { data, error } = await supabase
    .from('superchats')
    .select('author_channel_id,author_name,amount_value,currency,kind')
    .eq('video_id', PROTOTYPE_VIDEO_ID)

  if (error) {
    throw new Error(`superchats fetch failed: ${error.message}`)
  }

  const rows = (data ?? []) as SuperchatRow[]
  const byAuthor = new Map<string, AuthorStat>()
  for (const row of rows) {
    const stat = byAuthor.get(row.author_channel_id) ?? {
      channelId: row.author_channel_id,
      name: row.author_name,
      count: 0,
      total: 0,
    }
    stat.count += 1
    if (row.currency === 'JPY') {
      stat.total += Number(row.amount_value)
    }
    byAuthor.set(row.author_channel_id, stat)
  }

  const stats = [...byAuthor.values()]
  const byCount = [...stats].sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 30)
  const byAmount = [...stats].sort((a, b) => b.total - a.total || b.count - a.count).slice(0, 30)
  const grandTotal = stats.reduce((sum, stat) => sum + stat.total, 0)

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
            Prototype
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            スパチャランキング(試作)
          </h1>
          {stream && (
            <p className="text-sm leading-7 text-gray-300">
              対象:{' '}
              <Link
                href={`/stream/${stream.video_id}`}
                className="text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 hover:text-white"
              >
                {stream.title}
              </Link>
            </p>
          )}
          <p className="text-sm text-gray-400">
            {rows.length}件 / {stats.length}人 / 合計 ¥{grandTotal.toLocaleString()}
            (金額はJPYのみ集計)
          </p>
        </header>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold text-white">回数ランキング</h2>
          <ol className="space-y-2">
            {byCount.map((stat, index) => (
              <li
                key={stat.channelId}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <span className="w-8 shrink-0 font-mono text-gray-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-white">{stat.name}</span>
                <span className="shrink-0 text-gray-300">{stat.count}回</span>
                <span className="shrink-0 font-mono text-gray-400">¥{stat.total.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-white">金額ランキング</h2>
          <ol className="space-y-2">
            {byAmount.map((stat, index) => (
              <li
                key={stat.channelId}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <span className="w-8 shrink-0 font-mono text-gray-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-white">{stat.name}</span>
                <span className="shrink-0 font-mono text-gray-300">¥{stat.total.toLocaleString()}</span>
                <span className="shrink-0 text-gray-400">{stat.count}回</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  )
}
