import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { fetchAdminEntity, fetchAdminEntityStreams } from '../../actions'
import EntityEditorClient from './EntityEditorClient'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ name?: string }>
}

export default async function AdminEntityEditPage({ params, searchParams }: PageProps) {
  try {
    await requireRole(['admin'])
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      redirect('/login?return=/admin/entity')
    }
    throw error
  }

  const { id } = await params
  const isNew = id === 'new'
  const resolvedSearchParams = await searchParams
  const prefillName = isNew ? (resolvedSearchParams.name ?? '') : ''

  const [entity, streams] = await Promise.all([
    isNew ? Promise.resolve(null) : fetchAdminEntity(id),
    isNew ? Promise.resolve([]) : fetchAdminEntityStreams(id),
  ])

  return <EntityEditorClient entity={entity} streams={streams} prefillName={prefillName} />
}
