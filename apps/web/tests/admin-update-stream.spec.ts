import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

type StreamFixtureInput = {
  summary: string
  tags: string[] | null
}

async function assertFixtureTagsAreActive(tags: string[] | null) {
  if (!tags || tags.length === 0) {
    return
  }

  const service = getSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('tag_vocabulary')
    .select('slug')
    .eq('is_active', true)
    .in('slug', tags)

  if (error) {
    throw new Error(`Failed to validate stream fixture tags: ${error.message}`)
  }

  const activeSlugs = new Set((data ?? []).map((entry) => entry.slug as string))
  const invalidTags = tags.filter((tag) => !activeSlugs.has(tag))
  if (invalidTags.length > 0) {
    throw new Error(`Invalid stream fixture tags: ${invalidTags.join(', ')}`)
  }
}

function createUpdateInput(videoId: string, summary: string, tags?: string[] | null) {
  return {
    videoId,
    summary,
    tags,
    cornerNames: '',
    guests: '',
    songs: '',
    hasLiveSinging: false,
    talkTopics: '',
    highlights: [],
    isReviewed: false,
  }
}

async function createStreamFixture(input: StreamFixtureInput) {
  const service = getSupabaseServiceRoleClient()
  await assertFixtureTagsAreActive(input.tags)
  const videoId = `tagguard${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await service
    .from('streams')
    .insert({
      video_id: videoId,
      title: 'tag vocabulary guard integration fixture',
      stream_date: '2026-01-01',
      summary: input.summary,
      tags: input.tags,
      status: 'private',
    })
    .select('id, video_id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create stream fixture: ${error?.message ?? 'unknown error'}`)
  }

  return data as { id: string; video_id: string }
}

async function deleteStreamFixture(id: string) {
  const service = getSupabaseServiceRoleClient()
  const { error } = await service.from('streams').delete().eq('id', id)

  if (error) {
    throw new Error(`Failed to delete stream fixture: ${error.message}`)
  }
}

async function invokeUpdateAdminStream(videoId: string, summary: string, tags?: string[] | null) {
  return invokeServerAction({
    actionName: 'updateAdminStream',
    actionArgs: [createUpdateInput(videoId, summary, tags)],
    manifestRoute: 'admin/stream/[id]',
    pagePath: `/admin/stream/${videoId}`,
    role: 'admin',
  })
}

test.describe('updateAdminStream tag vocabulary integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(
    !testEnv?.serviceRoleKey,
    'SUPABASE_SERVICE_ROLE_KEY が未設定のため、stream fixture を作成できません。',
  )

  test('empty tags input is persisted as null', async () => {
    const service = getSupabaseServiceRoleClient()
    const fixture = await createStreamFixture({ summary: 'before', tags: ['gaming'] })

    try {
      const response = await invokeUpdateAdminStream(fixture.video_id, 'after', [])

      expect(response.status).toBe(200)
      expect(response.errorMessage).toBeNull()

      const { data, error } = await service
        .from('streams')
        .select('summary, tags')
        .eq('id', fixture.id)
        .single()

      expect(error).toBeNull()
      expect(data).toEqual({ summary: 'after', tags: null })
    } finally {
      await deleteStreamFixture(fixture.id)
    }
  })

  test('full replacement drops an unknown tag and keeps the active tag', async () => {
    const service = getSupabaseServiceRoleClient()
    const fixture = await createStreamFixture({ summary: 'before', tags: ['gaming'] })

    try {
      const response = await invokeUpdateAdminStream(
        fixture.video_id,
        'drop invalid tag update',
        ['gaming', 'unknown_tag'],
      )

      expect(response.status).toBe(200)
      expect(response.errorMessage).toBeNull()

      const { data, error } = await service
        .from('streams')
        .select('summary, tags')
        .eq('id', fixture.id)
        .single()

      expect(error).toBeNull()
      expect(data).toEqual({ summary: 'drop invalid tag update', tags: ['gaming'] })
    } finally {
      await deleteStreamFixture(fixture.id)
    }
  })

  test('inactive Japanese label and unknown tag are classified separately', async () => {
    const service = getSupabaseServiceRoleClient()
    const { data: inactiveVocabulary, error: vocabularyError } = await service
      .from('tag_vocabulary')
      .select('slug, label')
      .eq('is_active', false)
      .order('sort_order', { ascending: true })
      .limit(1)
      .single()

    if (vocabularyError || !inactiveVocabulary) {
      throw new Error(`Inactive tag fixture is unavailable: ${vocabularyError?.message ?? 'not found'}`)
    }

    const unknownTag = 'admin_update_unknown_probe'
    const fixture = await createStreamFixture({ summary: 'before', tags: ['gaming'] })

    try {
      const response = await invokeUpdateAdminStream(
        fixture.video_id,
        'classify inactive label update',
        [inactiveVocabulary.label as string, unknownTag],
      )

      expect(response.status).toBe(200)
      expect(response.errorMessage).toBeNull()
      expect(response.text).toContain('droppedInvalidTags')
      expect(response.text).toContain(unknownTag)
      expect(response.text).toContain('droppedInactiveTags')
      expect(response.text).toContain(inactiveVocabulary.slug as string)

      const { data, error } = await service
        .from('streams')
        .select('summary, tags')
        .eq('id', fixture.id)
        .single()

      expect(error).toBeNull()
      expect(data).toEqual({ summary: 'classify inactive label update', tags: null })
    } finally {
      await deleteStreamFixture(fixture.id)
    }
  })
})
