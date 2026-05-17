import StreamEditorClient from './StreamEditorClient'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function AdminStreamPage({ params }: PageProps) {
  const { id } = await params

  return <StreamEditorClient videoId={id} />
}
