import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { getTestEnv, type TestEnv } from './env'

export type TestRole = 'editor' | 'admin'

const APP_BASE_URL = 'http://localhost:3000'

type StoredCookie = {
  name: string
  value: string
  options?: CookieOptions
}

function requireTestEnv(): TestEnv {
  const env = getTestEnv()

  if (!env) {
    throw new Error('.env.test is required to use auth test helpers.')
  }

  return env
}

function getRoleCredentials(env: TestEnv, role: TestRole) {
  if (role === 'admin') {
    return {
      email: env.adminEmail,
      password: env.adminPassword,
    }
  }

  return {
    email: env.editorEmail,
    password: env.editorPassword,
  }
}

function toPlaywrightSameSite(sameSite?: CookieOptions['sameSite']) {
  if (sameSite === 'strict' || sameSite === true) {
    return 'Strict' as const
  }

  if (sameSite === 'none') {
    return 'None' as const
  }

  return 'Lax' as const
}

function createCookieStore() {
  const cookies = new Map<string, StoredCookie>()

  return {
    getAll() {
      return Array.from(cookies.values()).map(({ name, value }) => ({ name, value }))
    },
    setAll(cookiesToSet: StoredCookie[]) {
      for (const cookie of cookiesToSet) {
        if (!cookie.value || cookie.options?.maxAge === 0) {
          cookies.delete(cookie.name)
          continue
        }

        cookies.set(cookie.name, cookie)
      }
    },
    toPlaywrightCookies() {
      return Array.from(cookies.values()).map(({ name, value, options }) => ({
        name,
        value,
        domain: 'localhost',
        path: options?.path ?? '/',
        httpOnly: options?.httpOnly ?? false,
        secure: options?.secure ?? APP_BASE_URL.startsWith('https://'),
        sameSite: toPlaywrightSameSite(options?.sameSite),
        expires: typeof options?.maxAge === 'number'
          ? Math.floor(Date.now() / 1_000) + options.maxAge
          : -1,
      }))
    },
  }
}

async function createSupabaseRoleClient(role: TestRole): Promise<SupabaseClient> {
  const env = requireTestEnv()
  const credentials = getRoleCredentials(env, role)
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { error } = await supabase.auth.signInWithPassword(credentials)
  if (error) {
    throw new Error(`Failed to sign in ${role} test user: ${error.message}`)
  }

  return supabase
}

async function createAuthCookies(role: TestRole) {
  const env = requireTestEnv()
  const credentials = getRoleCredentials(env, role)
  const cookieStore = createCookieStore()
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => cookieStore.setAll(cookiesToSet),
    },
  })

  const { error } = await supabase.auth.signInWithPassword(credentials)
  if (error) {
    throw new Error(`Failed to create auth cookies for ${role}: ${error.message}`)
  }

  return cookieStore.toPlaywrightCookies()
}

export async function loginAs(page: Page, role: TestRole) {
  await page.context().clearCookies()
  const cookies = await createAuthCookies(role)
  await page.context().addCookies(cookies)
}

export async function logout(page: Page) {
  await page.goto('/member')
  await Promise.all([
    page.waitForURL('**/'),
    page.getByRole('button', { name: 'ログアウト' }).click(),
  ])
}

export function getSupabaseAnonClient() {
  const env = requireTestEnv()

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function getSupabaseRoleClient(role: TestRole) {
  return createSupabaseRoleClient(role)
}
