import { expect, test } from '@playwright/test'
import {
  ensureRevokedUser,
  getSupabaseAnonClient,
  getSupabaseRoleClient,
  getSupabaseServiceRoleClient,
} from '../helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()
const ENTITY_FIXTURE_SLUG = 'e2e-section11-rls'

function expectPermissionDenied(error: { code?: string | null } | null) {
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
}

function expectRlsWriteDenied(error: {
  code?: string | null
  message?: string
  details?: string
} | null) {
  expect(error).not.toBeNull()

  const combinedMessage = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
  expect(error?.code === '42501' || combinedMessage.includes('row-level security')).toBe(true)
}

async function requireStreamIds() {
  const service = getSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('streams')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(2)

  if (error) {
    throw new Error(`Failed to load stream fixtures: ${error.message}`)
  }

  if (!data || data.length < 2) {
    throw new Error('Section 11 RLS tests require at least 2 seeded streams.')
  }

  return {
    selectStreamId: data[0].id,
    insertStreamId: data[1].id,
  }
}

async function ensureEntityFixture() {
  const service = getSupabaseServiceRoleClient()
  const { data: existing, error: existingError } = await service
    .from('entities')
    .select('id')
    .eq('slug', ENTITY_FIXTURE_SLUG)
    .limit(1)

  if (existingError) {
    throw new Error(`Failed to query entity fixture: ${existingError.message}`)
  }

  if (existing && existing.length > 0) {
    return existing[0].id
  }

  const { data, error } = await service
    .from('entities')
    .insert({
      slug: ENTITY_FIXTURE_SLUG,
      name: 'Section11 RLS Fixture',
      match_names: ['Section11 RLS Fixture'],
      category: 'project',
      role: null,
      description: 'RLS fixture entity for Section 11 E2E tests.',
      related_work: null,
      external_url: null,
      sort_order: 9999,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create entity fixture: ${error?.message ?? 'unknown error'}`)
  }

  return data.id
}

test.describe('Section 11 RLS', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('bookmarks テーブル直接 SELECT（anon key）は 42501 で拒否される', async () => {
    const supabase = getSupabaseAnonClient()
    const { error } = await supabase.from('bookmarks').select('*').limit(1)

    expectPermissionDenied(error)
  })

  test.describe('権限剥奪済み authenticated session', () => {
    test.describe.configure({ mode: 'serial' })
    test.skip(
      !testEnv?.serviceRoleKey,
      'SUPABASE_SERVICE_ROLE_KEY が未設定のため、権限剥奪済みユーザーフィクスチャを作成できません。',
    )

    let revokedUserId = ''
    let selectStreamId = ''
    let insertStreamId = ''
    let entityId = ''
    let seededRequestId = ''
    let insertWord = ''

    test.beforeAll(async () => {
      const service = getSupabaseServiceRoleClient()
      const revokedUser = await ensureRevokedUser()
      const streamIds = await requireStreamIds()

      revokedUserId = revokedUser.id
      selectStreamId = streamIds.selectStreamId
      insertStreamId = streamIds.insertStreamId
      entityId = await ensureEntityFixture()
      insertWord = `e2e-section11-insert-${Date.now()}`

      const { error: bookmarkError } = await service
        .from('bookmarks')
        .upsert({
          user_id: revokedUserId,
          stream_id: selectStreamId,
        }, {
          onConflict: 'user_id,stream_id',
        })

      if (bookmarkError) {
        throw new Error(`Failed to seed bookmark fixture: ${bookmarkError.message}`)
      }

      const { data: seededRequest, error: requestError } = await service
        .from('entity_word_requests')
        .insert({
          entity_id: entityId,
          word: `e2e-section11-visible-${Date.now()}`,
          status: 'pending',
          requested_by: revokedUserId,
        })
        .select('id')
        .single()

      if (requestError || !seededRequest) {
        throw new Error(`Failed to seed entity word request fixture: ${requestError?.message ?? 'unknown error'}`)
      }

      seededRequestId = seededRequest.id
    })

    test.afterAll(async () => {
      const service = getSupabaseServiceRoleClient()

      if (seededRequestId) {
        await service
          .from('entity_word_requests')
          .delete()
          .eq('id', seededRequestId)
      }

      if (revokedUserId && selectStreamId) {
        await service
          .from('bookmarks')
          .delete()
          .eq('user_id', revokedUserId)
          .eq('stream_id', selectStreamId)
      }
    })

    test('bookmarks SELECT は 0 行になる', async () => {
      const supabase = await getSupabaseRoleClient('revoked')
      const { data, error } = await supabase
        .from('bookmarks')
        .select('*')
        .eq('user_id', revokedUserId)

      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    test('bookmarks INSERT は RLS WITH CHECK 違反になる', async () => {
      const supabase = await getSupabaseRoleClient('revoked')
      const { error } = await supabase
        .from('bookmarks')
        .insert({
          user_id: revokedUserId,
          stream_id: insertStreamId,
        })

      expectRlsWriteDenied(error)
    })

    test('entity_word_requests SELECT は 0 行になる', async () => {
      const supabase = await getSupabaseRoleClient('revoked')
      const { data, error } = await supabase
        .from('entity_word_requests')
        .select('*')
        .eq('requested_by', revokedUserId)

      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    test('entity_word_requests INSERT は RLS WITH CHECK 違反になる', async () => {
      const supabase = await getSupabaseRoleClient('revoked')
      const { error } = await supabase
        .from('entity_word_requests')
        .insert({
          entity_id: entityId,
          word: insertWord,
          requested_by: revokedUserId,
        })

      expectRlsWriteDenied(error)
    })
  })
})
