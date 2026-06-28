import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { logoutAction } from '@/lib/auth-actions'
import { fetchSearchLogStats, type SearchLogStats } from './actions'
import AdminPageClient from './AdminPageClient'

export default async function AdminPage() {
  try {
    await requireRole(['admin'])
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      redirect('/login?return=/admin')
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      redirect('/member')
    }
    throw error
  }

  let initialSearchLogStats: SearchLogStats = {
    topQueries: [],
    dailyCounts: [],
  }
  let searchLogStatsError: string | null = null

  try {
    initialSearchLogStats = await fetchSearchLogStats()
  } catch {
    searchLogStatsError = '検索ログ集計の取得に失敗しました。'
  }

  return (
    <AdminPageClient
      logoutAction={logoutAction}
      initialSearchLogStats={initialSearchLogStats}
      searchLogStatsError={searchLogStatsError}
    />
  )
}
