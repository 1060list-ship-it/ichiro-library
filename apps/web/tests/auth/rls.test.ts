import { expect, test } from '@playwright/test'
import { getSupabaseAnonClient, getSupabaseRoleClient } from '../helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from '../helpers/env'

const testEnv = getTestEnv()

function expectPermissionDenied(error: { code?: string } | null) {
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
}

test.describe('RLS', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('anon key では bookmarks SELECT が 42501 で拒否される', async () => {
    const supabase = getSupabaseAnonClient()
    const { error } = await supabase.from('bookmarks').select('*').limit(1)

    expectPermissionDenied(error)
  })

  test('anon key の search_streams RPC は成功し、transcript 列を返さない', async () => {
    const supabase = getSupabaseAnonClient()
    const { data, error } = await supabase.rpc('search_streams', {
      page_num: 1,
      page_size: 1,
    })

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)

    for (const row of data ?? []) {
      expect(row).not.toHaveProperty('transcript')
    }
  })

  test('editor セッションで streams.transcript を直接 SELECT すると 42501 になる', async () => {
    const supabase = await getSupabaseRoleClient('editor')
    const { error } = await supabase.from('streams').select('transcript').limit(1)

    expectPermissionDenied(error)
  })

  test.fixme('editor セッションで chapters.transcript_segment を直接 SELECT すると 42501 になる', async () => {
    const supabase = await getSupabaseRoleClient('editor')
    const { error } = await supabase.from('chapters').select('transcript_segment').limit(1)

    expectPermissionDenied(error)
  })
})
