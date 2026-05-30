import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { Entity, Stream } from '@/lib/types'

const CATEGORY_LABELS: Record<string, string> = {
  family: '家族・地元',
  celebrity: '交友・影響元',
  remixer: 'リミキサー',
  team: 'チーム',
  craftsman: '職人',
  product: 'コラボ製品',
  project: 'プロジェクト',
}

type PageProps = {
  params: Promise<{ slug: string }>
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

async function fetchRelatedStreams(entityId: string): Promise<Pick<Stream, 'id' | 'video_id' | 'title' | 'stream_date' | 'thumbnail_url' | 'summary'>[]> {
  const { data: relationRows, error: relationError } = await supabase
    .from('stream_entities')
    .select('stream_id')
    .eq('entity_id', entityId)

  if (relationError || !relationRows?.length) return []

  const streamIds = ((relationRows ?? []) as unknown as { stream_id: string }[]).map((row) => row.stream_id)
  const { data, error } = await supabase
    .from('streams')
    .select('id, video_id, title, stream_date, thumbnail_url, summary')
    .in('id', streamIds)
    .order('stream_date', { ascending: false })
    .limit(12)

  if (error) return []
  return data ?? []
}

export default async function EntityDetailPage({ params }: PageProps) {
  const { slug } = await params
  await connection()

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error || !data) {
    notFound()
  }

  const entity = data as Entity
  const relatedStreams = await fetchRelatedStreams(entity.id)

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800/80 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/entity" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← 索引へ
          </Link>
          <Link href="/magazine" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            マガジン
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-indigo-300 bg-indigo-950/60 border border-indigo-900/80 px-2.5 py-1 rounded-full">
              {categoryLabel(entity.category)}
            </span>
            {entity.role && <span className="text-xs text-gray-500">{entity.role}</span>}
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-bold leading-tight">{entity.name}</h1>
            <p className="text-base text-gray-300 leading-8">{entity.description}</p>
          </div>
        </section>

        {entity.related_work && (
          <section className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-2">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">Related Work</p>
            <p className="text-sm text-gray-200 leading-relaxed">{entity.related_work}</p>
          </section>
        )}

        {entity.external_url && (
          <section>
            <a
              href={entity.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm text-indigo-300 hover:text-indigo-200 transition-colors"
            >
              外部リンクを開く →
            </a>
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-0.5 h-4 bg-indigo-500 rounded-full" />
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">関連配信</h2>
          </div>

          {relatedStreams.length > 0 ? (
            <div className="space-y-3">
              {relatedStreams.map((stream) => {
                const date = new Date(stream.stream_date).toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })

                return (
                  <Link
                    key={stream.id}
                    href={`/stream/${stream.video_id}`}
                    className="flex gap-3 bg-gray-900 rounded-lg border border-gray-800 p-3 hover:border-indigo-700/80 hover:bg-gray-900/80 transition-colors"
                  >
                    {stream.thumbnail_url && (
                      <img
                        src={stream.thumbnail_url}
                        alt=""
                        className="w-24 h-14 object-cover rounded-md flex-shrink-0 bg-gray-800"
                      />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs text-gray-500">{date}</p>
                      <h3 className="text-sm text-gray-100 font-semibold leading-snug line-clamp-2">{stream.title}</h3>
                      {stream.summary && <p className="text-xs text-gray-500 line-clamp-2">{stream.summary}</p>}
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-lg border border-gray-800 p-4">
              まだ関連配信は抽出されていません。
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
