import { test, expect, browserFetchJson, getSupabaseSkipReason } from './fixtures'

test.describe('security', () => {
  test('anon REST API で streams.transcript を直接読めない', async ({ page, supabaseAnon }) => {
    test.skip(!supabaseAnon, getSupabaseSkipReason())

    await page.goto('/')

    const response = await browserFetchJson(
      page,
      `${supabaseAnon!.url}/rest/v1/streams?select=transcript&limit=1`,
      {
        headers: {
          apikey: supabaseAnon!.anonKey,
          Authorization: `Bearer ${supabaseAnon!.anonKey}`,
        },
      },
    )

    const json = response.json

    if (response.status === 200) {
      expect(Array.isArray(json)).toBe(true)
      expect(json).toEqual([])
      return
    }

    expect(json).toMatchObject({
      code: '42501',
    })
  })
})
