import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import StreamEditorClient from './StreamEditorClient'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function AdminStreamPage({ params }: PageProps) {
  try {
    await requireRole(['admin'])
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      redirect('/login?return=/admin')
    }
    throw error
  }

  const { id } = await params

  return <StreamEditorClient videoId={id} />
}
