import { redirect } from 'next/navigation'
import { checkAdminSession, fetchAdminEntity, fetchAdminEntityStreams } from '../../actions'
import EntityEditorClient from './EntityEditorClient'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ name?: string }>
}

export default async function AdminEntityEditPage({ params, searchParams }: PageProps) {
  const authenticated = await checkAdminSession()
  if (!authenticated) redirect('/admin')

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
