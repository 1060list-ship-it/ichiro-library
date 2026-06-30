import { PUBLIC_STREAM_CARD_SELECT } from './selects'
import type { Stream } from './types'

export const HOME_CATEGORIES = [
  { key: 'top', label: '最新' },
  { key: 'ranking-view', label: '再生数' },
] as const

export type HomeView = 'top' | string

export type ActiveCardFilter = {
  kind: 'tag' | 'corner'
  value: string
}

type HomeStreamBase = Pick<
  Stream,
  | 'id'
  | 'video_id'
  | 'title'
  | 'stream_date'
  | 'duration_min'
  | 'view_count'
  | 'comment_count'
  | 'summary'
  | 'tags'
  | 'corner_names'
  | 'thumbnail_url'
>

export type HomeStream = HomeStreamBase & {
  chapters: { stream_id: string }[] | null
}

export type HomePageState = {
  view: HomeView
  query: string
  fuzzy: boolean
  year: number | null
  activeFilter: ActiveCardFilter | null
}

export type HomePageMeta = {
  availableYears: number[]
  latestUpdatedAt: string | null
}

export type HomePageStreamResult = {
  streams: HomeStream[]
  resultCount: number
}

async function attachChapterStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  streams: HomeStreamBase[],
): Promise<HomeStream[]> {
  if (streams.length === 0) {
    return []
  }

  const streamIds = [...new Set(streams.map((stream) => stream.id))]
  const chapterRes = await client.from('chapters').select('stream_id').in('stream_id', streamIds)
  const streamIdsWithChapters = new Set(
    ((chapterRes.data ?? []) as { stream_id: string }[]).map((chapter) => chapter.stream_id),
  )

  return streams.map((stream) => ({
    ...stream,
    chapters: streamIdsWithChapters.has(stream.id) ? [{ stream_id: stream.id }] : [],
  }))
}

type SearchParamValue = string | string[] | undefined

function getSingleSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function getHomePageStateFromSearchParams(searchParams: {
  q?: SearchParamValue
  view?: SearchParamValue
  fuzzy?: SearchParamValue
  year?: SearchParamValue
  tag?: SearchParamValue
  corner?: SearchParamValue
}): HomePageState {
  const rawYear = getSingleSearchParam(searchParams.year)
  const tag = getSingleSearchParam(searchParams.tag)
  const corner = getSingleSearchParam(searchParams.corner)

  return {
    view: getSingleSearchParam(searchParams.view) || 'top',
    query: getSingleSearchParam(searchParams.q),
    fuzzy: getSingleSearchParam(searchParams.fuzzy) === '1',
    year: rawYear ? Number.parseInt(rawYear, 10) : null,
    activeFilter: tag
      ? { kind: 'tag', value: tag }
      : corner
        ? { kind: 'corner', value: corner }
        : null,
  }
}

export function matchesCardFilter(stream: Pick<Stream, 'tags' | 'corner_names'>, filter: ActiveCardFilter | null) {
  if (!filter) {
    return true
  }

  if (filter.kind === 'tag') {
    return (stream.tags ?? []).includes(filter.value)
  }

  return (stream.corner_names ?? []).includes(filter.value)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCardFilter(query: any, filter: ActiveCardFilter | null) {
  if (!filter) {
    return query
  }

  if (filter.kind === 'tag') {
    return query.contains('tags', [filter.value])
  }

  return query.contains('corner_names', [filter.value])
}

export function parseJapaneseDateFromQuery(q: string): {
  year: number | null
  month: number | null
  remaining: string
  label: string | null
} {
  const ymMatch = q.match(/(\d{4})年(\d{1,2})月/)
  if (ymMatch) {
    return {
      year: Number.parseInt(ymMatch[1], 10),
      month: Number.parseInt(ymMatch[2], 10),
      remaining: q.replace(ymMatch[0], '').trim(),
      label: `${ymMatch[1]}年${ymMatch[2]}月`,
    }
  }

  const yMatch = q.match(/(\d{4})年/)
  if (yMatch) {
    return {
      year: Number.parseInt(yMatch[1], 10),
      month: null,
      remaining: q.replace(yMatch[0], '').trim(),
      label: `${yMatch[1]}年`,
    }
  }

  return { year: null, month: null, remaining: q, label: null }
}

export async function fetchHomePageMeta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
): Promise<HomePageMeta> {
  const [yearRes, updatedRes] = await Promise.all([
    client.from('streams').select('stream_date').not('stream_date', 'is', null),
    client.from('streams').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const availableYears = yearRes.data
    ? [...new Set((yearRes.data as { stream_date: string }[]).map((row) => new Date(row.stream_date).getFullYear()))]
      .sort((a, b) => b - a)
    : []

  return {
    availableYears,
    latestUpdatedAt: updatedRes.data?.updated_at ?? null,
  }
}

export async function fetchHomePageStreams(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  state: HomePageState,
): Promise<HomePageStreamResult> {
  const { view, query, fuzzy, year, activeFilter } = state

  let streams: HomeStreamBase[] = []
  let resultCount = 0

  const parsed = parseJapaneseDateFromQuery(query.trim())
  const textQuery = parsed.remaining
  const effectiveYear = parsed.year ?? year
  const effectiveMonth = parsed.month

  let dateFrom: string | null = null
  let dateTo: string | null = null

  if (effectiveYear !== null && effectiveMonth !== null) {
    dateFrom = `${effectiveYear}-${String(effectiveMonth).padStart(2, '0')}-01`
    const nextMonth = effectiveMonth === 12 ? 1 : effectiveMonth + 1
    const nextYear = effectiveMonth === 12 ? effectiveYear + 1 : effectiveYear
    dateTo = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  } else if (effectiveYear !== null) {
    dateFrom = `${effectiveYear}-01-01`
    dateTo = `${effectiveYear + 1}-01-01`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyYearDate = (target: any) => (dateFrom ? target.gte('stream_date', dateFrom).lt('stream_date', dateTo) : target)

  if (query.trim() && textQuery.trim()) {
    const parts = textQuery.trim().split(/\s+/).filter(Boolean)
    const includes = parts.filter((keyword) => !keyword.startsWith('-'))
    const excludes = parts.filter((keyword) => keyword.startsWith('-')).map((keyword) => keyword.slice(1)).filter(Boolean)

    if (fuzzy) {
      const res = await client.rpc('search_streams', {
        query: includes.join(' ') || textQuery,
        sort_by: 'date_desc',
        page_num: 1,
        page_size: 500,
      })

      let results = (res.data ?? []) as HomeStreamBase[]

      if (dateFrom) {
        results = results.filter((stream) => stream.stream_date >= dateFrom! && stream.stream_date < dateTo!)
      }

      results = results.filter((stream) => matchesCardFilter(stream, activeFilter))

      const filtered = excludes.length > 0
        ? results.filter((stream) => excludes.every((excluded) => (
          !stream.title?.toLowerCase().includes(excluded.toLowerCase())
          && !stream.summary?.toLowerCase().includes(excluded.toLowerCase())
        )))
        : results

      resultCount = filtered.length
      streams = filtered.slice(0, 50)
    } else {
      let textStreams: HomeStreamBase[] = []

      if (includes.length > 0) {
        const textConditions = includes.flatMap((keyword) => (
          [`title.ilike.%${keyword}%`, `summary.ilike.%${keyword}%`]
        )).join(',')

        let textQueryBuilder = applyCardFilter(
          applyYearDate(client.from('streams').select(PUBLIC_STREAM_CARD_SELECT).or(textConditions)),
          activeFilter,
        )

        for (const excluded of excludes) {
          textQueryBuilder = textQueryBuilder
            .not('title', 'ilike', `%${excluded}%`)
            .not('summary', 'ilike', `%${excluded}%`)
        }

        const textRes = await textQueryBuilder.order('stream_date', { ascending: false })
        textStreams = (textRes.data ?? []) as HomeStreamBase[]
      }

      const entityIds = new Set<string>()

      await Promise.all(includes.map(async (keyword) => {
        const [byName, byAlias] = await Promise.all([
          client.from('entities').select('id').ilike('name', `%${keyword}%`),
          client.from('entities').select('id').contains('match_names', [keyword]),
        ])

        for (const entity of byName.data ?? []) {
          entityIds.add(entity.id)
        }

        for (const entity of byAlias.data ?? []) {
          entityIds.add(entity.id)
        }
      }))

      let entityStreams: HomeStreamBase[] = []

      if (entityIds.size > 0) {
        const seRes = await client.from('stream_entities').select('stream_id').in('entity_id', [...entityIds])
        const streamIds = (seRes.data ?? []).map((row: { stream_id: string }) => row.stream_id)

        if (streamIds.length > 0) {
          let entityQueryBuilder = applyCardFilter(
            applyYearDate(client.from('streams').select(PUBLIC_STREAM_CARD_SELECT).in('id', streamIds)),
            activeFilter,
          )

          for (const excluded of excludes) {
            entityQueryBuilder = entityQueryBuilder
              .not('title', 'ilike', `%${excluded}%`)
              .not('summary', 'ilike', `%${excluded}%`)
          }

          const entityRes = await entityQueryBuilder.order('stream_date', { ascending: false })
          entityStreams = (entityRes.data ?? []) as HomeStreamBase[]
        }
      }

      const seen = new Set<string>()
      const merged = [...textStreams, ...entityStreams].filter((stream) => {
        if (seen.has(stream.id)) {
          return false
        }

        seen.add(stream.id)
        return true
      })

      merged.sort((left, right) => new Date(right.stream_date).getTime() - new Date(left.stream_date).getTime())
      resultCount = merged.length
      streams = merged.slice(0, 20)
    }
  } else if (query.trim()) {
    const countRes = await applyCardFilter(
      applyYearDate(client.from('streams').select('id', { count: 'exact', head: true })),
      activeFilter,
    )

    resultCount = countRes.count ?? 0

    const res = await applyCardFilter(
      applyYearDate(client.from('streams').select(PUBLIC_STREAM_CARD_SELECT)),
      activeFilter,
    )
      .order('stream_date', { ascending: false })
      .limit(50)

    streams = (res.data ?? []) as HomeStreamBase[]
  } else if (view === 'top') {
    const countRes = await applyCardFilter(
      applyYearDate(client.from('streams').select('id', { count: 'exact', head: true })),
      activeFilter,
    )

    resultCount = countRes.count ?? 0

    const res = await applyCardFilter(
      applyYearDate(client.from('streams').select(PUBLIC_STREAM_CARD_SELECT)),
      activeFilter,
    )
      .order('stream_date', { ascending: false })
      .limit(year ? 20 : 10)

    streams = (res.data ?? []) as HomeStreamBase[]
  } else if (view === 'ranking-view') {
    const countRes = await applyCardFilter(
      applyYearDate(client.from('streams').select('id', { count: 'exact', head: true })),
      activeFilter,
    )

    resultCount = countRes.count ?? 0

    const res = await applyCardFilter(
      applyYearDate(client.from('streams').select(PUBLIC_STREAM_CARD_SELECT)),
      activeFilter,
    )
      .order('view_count', { ascending: false })
      .limit(20)

    streams = (res.data ?? []) as HomeStreamBase[]
  }

  return {
    streams: await attachChapterStatus(client, streams),
    resultCount,
  }
}
