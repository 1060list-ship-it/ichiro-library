import Link from 'next/link'
import { connection } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { Entity } from '@/lib/types'

const CATEGORY_LABELS: Record<string, string> = {
  family: '家族・地元',
  celebrity: '交友・影響元',
  remixer: 'リミキサー',
  team: 'チーム',
  craftsman: '職人',
  product: 'コラボ製品',
  project: 'プロジェクト',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

export default async function EntityHubPage() {
  await connection()

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    throw error
  }

  const entities = (data ?? []) as Entity[]
  const grouped = entities.reduce<Record<string, Entity[]>>((acc, entity) => {
    const key = entity.category
    acc[key] = acc[key] ?? []
    acc[key].push(entity)
    return acc
  }, {})

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800/80 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/magazine" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← マガジンへ
          </Link>
          <span className="text-xs text-gray-500">いちろう人物・関係性ノート</span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="space-y-2">
          <p className="text-xs text-indigo-300 uppercase tracking-widest">Entity Index</p>
          <h1 className="text-2xl font-bold leading-tight">人物・作品・チーム</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            マガジンや配信に登場する固有名詞を、関係性ごとに辿るための索引です。
          </p>
        </div>

        {Object.entries(grouped).map(([category, items]) => (
          <section key={category} className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-0.5 h-4 bg-indigo-500 rounded-full" />
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                {categoryLabel(category)}
              </h2>
              <span className="text-xs text-gray-600">{items.length}件</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((entity) => (
                <Link
                  key={entity.id}
                  href={`/entity/${entity.slug}`}
                  className="block bg-gray-900 rounded-lg border border-gray-800 p-4 hover:border-indigo-700/80 hover:bg-gray-900/80 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-bold text-white leading-snug">{entity.name}</h3>
                      <span className="text-[11px] text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded-full flex-shrink-0">
                        {categoryLabel(entity.category)}
                      </span>
                    </div>
                    {entity.role && <p className="text-xs text-gray-500 leading-relaxed">{entity.role}</p>}
                    <p className="text-sm text-gray-300 leading-relaxed line-clamp-3">{entity.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
