import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { logoutAction } from './actions'
import AdminPageClient from './AdminPageClient'

export default async function AdminPage() {
  try {
    await requireRole(['admin'])
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      redirect('/login?return=/admin')
    }
    throw error
  }

  return <AdminPageClient logoutAction={logoutAction} />
}
