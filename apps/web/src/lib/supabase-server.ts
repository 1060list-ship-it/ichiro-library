import { createServerClient, type CookieOptions, type SetAllCookies } from '@supabase/ssr'
import type { Database } from './types'

type SupabaseCookie = {
  name: string
  value: string
}

type CookieStoreLike = {
  getAll: () => SupabaseCookie[] | Promise<SupabaseCookie[]>
  set?: (name: string, value: string, options?: CookieOptions) => unknown | Promise<unknown>
}

type SupabaseCookieMethods = {
  getAll: () => SupabaseCookie[] | Promise<SupabaseCookie[]>
  setAll?: SetAllCookies
}

type CreateSupabaseServerClientOptions = {
  cookies?: SupabaseCookieMethods
  cookieStore?: CookieStoreLike
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です')
}

const SUPABASE_URL = supabaseUrl
const SUPABASE_ANON_KEY = supabaseAnonKey

function createCookieMethodsFromStore(cookieStore: CookieStoreLike): SupabaseCookieMethods {
  return {
    getAll: () => cookieStore.getAll(),
    setAll: async (cookiesToSet, headers) => {
      if (!cookieStore.set) {
        return
      }

      for (const { name, value, options } of cookiesToSet) {
        try {
          await cookieStore.set(name, value, options)
        } catch {
          // Server Components では cookies().set() が許可されない。更新は middleware 側で行う。
        }
      }

      void headers
    },
  }
}

async function createDefaultCookieMethods(): Promise<SupabaseCookieMethods> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  return createCookieMethodsFromStore(cookieStore)
}

export async function createSupabaseServerClient(options: CreateSupabaseServerClientOptions = {}) {
  const cookieMethods = options.cookies
    ?? (options.cookieStore ? createCookieMethodsFromStore(options.cookieStore) : await createDefaultCookieMethods())

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: cookieMethods,
  })
}

export function hasSupabaseAuthCookie(cookies: readonly SupabaseCookie[]) {
  return cookies.some((cookie) => (
    cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')
  ))
}
