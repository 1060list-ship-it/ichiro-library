import { requireRoleOrRedirect } from '@/lib/auth'
import StreamEditorClient from './StreamEditorClient'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function AdminStreamPage({ params }: PageProps) {
  const { id } = await params
  await requireRoleOrRedirect(['admin'], '/admin/stream/' + id)

  return <StreamEditorClient videoId={id} />
}
