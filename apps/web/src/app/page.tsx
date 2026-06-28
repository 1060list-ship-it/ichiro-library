import HomePageClient from './HomePageClient'
import { verifySession } from '@/lib/auth'
import { fetchHomePageMeta, fetchHomePageStreams, getHomePageStateFromSearchParams } from '@/lib/home-page'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type PageProps = {
  searchParams: Promise<{
    q?: string | string[]
    view?: string | string[]
    fuzzy?: string | string[]
    year?: string | string[]
    tag?: string | string[]
    corner?: string | string[]
  }>
}

export default async function HomePage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams
  const initialState = getHomePageStateFromSearchParams(resolvedSearchParams)
  const supabase = await createSupabaseServerClient()
  const session = await verifySession()
  const currentUserId = session?.user.id ?? null

  const [meta, streamResult, bookmarkResult] = await Promise.all([
    fetchHomePageMeta(supabase),
    fetchHomePageStreams(supabase, initialState),
    currentUserId
      ? supabaseAdmin
        .from('bookmarks')
        .select('stream_id')
        .eq('user_id', currentUserId)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (bookmarkResult.error) {
    throw new Error(`bookmarks fetch failed: ${bookmarkResult.error.message}`)
  }

  const bookmarkedStreamIds = (bookmarkResult.data ?? []).map((row: { stream_id: string }) => row.stream_id)

  return (
    <HomePageClient
      initialState={initialState}
      initialStreams={streamResult.streams}
      initialResultCount={streamResult.resultCount}
      initialAvailableYears={meta.availableYears}
      initialLatestUpdatedAt={meta.latestUpdatedAt}
      currentUserId={currentUserId}
      bookmarkedStreamIds={bookmarkedStreamIds}
    />
  )
}
