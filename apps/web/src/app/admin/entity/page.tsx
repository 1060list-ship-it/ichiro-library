import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { fetchAdminEntities } from '../actions'
import type { AdminEntity } from '../actions'

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

export default async function AdminEntityPage() {
  try {
    await requireRole(['admin'])
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      redirect('/login?return=/admin/entity')
    }
    throw error
  }

  const entities = await fetchAdminEntities()

  const grouped = entities.reduce<Record<string, AdminEntity[]>>((acc, e) => {
    acc[e.category] = acc[e.category] ?? []
    acc[e.category].push(e)
    return acc
  }, {})

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-gray-400 hover:text-white transition-colors">
              ← 管理画面
            </Link>
            <h1 className="text-lg font-semibold">エンティティ管理</h1>
          </div>
          <Link
            href="/admin/entity/new"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200"
          >
            + 新規追加
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {entities.length === 0 ? (
          <p className="text-sm text-gray-500">エンティティがまだありません。</p>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <section key={category} className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                  {categoryLabel(category)}
                </h2>
                <span className="text-xs text-gray-600">{items.length}件</span>
              </div>
              <div className="divide-y divide-gray-800">
                {items.map(entity => (
                  <div key={entity.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-white">{entity.name}</p>
                      {entity.match_names.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {entity.match_names.map(n => (
                            <span key={n} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                      {entity.role && <p className="text-xs text-gray-500">{entity.role}</p>}
                    </div>
                    <Link
                      href={`/admin/entity/${entity.id}`}
                      className="flex-shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                    >
                      編集
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  )
}
