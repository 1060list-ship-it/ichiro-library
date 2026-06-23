import { requireRoleOrRedirect } from '@/lib/auth'
import { logoutAction } from './actions'
import AdminPageClient from './AdminPageClient'

export default async function AdminPage() {
  await requireRoleOrRedirect(['admin'], '/admin')

  return <AdminPageClient logoutAction={logoutAction} />
}
