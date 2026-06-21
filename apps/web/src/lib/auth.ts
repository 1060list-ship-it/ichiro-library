import 'server-only'

import { createHash } from 'node:crypto'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from './supabase-admin'
import { createSupabaseServerClient } from './supabase-server'
import type { UserRole } from './types'

const ADMIN_COOKIE_NAME = 'ichiro-library-admin'
const SAFE_RETURN_TO_PATTERN = /^\/(?![\/\\])[\x20-\x5B\x5D-\x7E]*$/

type VerifiedSession = {
  user: User
}

export type RequireRoleResult =
  | {
      user: User
      role: UserRole
      isLegacyBridge: false
    }
  | {
      user: null
      role: 'admin'
      isLegacyBridge: true
    }

function getLegacyAdminCookieValue() {
  const password = process.env.ADMIN_PASSWORD

  if (!password) {
    return null
  }

  return createHash('sha256')
    .update(`ichiro-library:${password}`)
    .digest('hex')
}

const hasLegacyAdminSession = cache(async () => {
  const expectedCookieValue = getLegacyAdminCookieValue()

  if (!expectedCookieValue) {
    return false
  }

  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  return cookieStore.get(ADMIN_COOKIE_NAME)?.value === expectedCookieValue
})

export const verifySession = cache(async (): Promise<VerifiedSession | null> => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    if (error.status === 400 || error.status === 401) {
      return null
    }

    throw new Error(`Supabase Auth session verification failed: ${error.message}`)
  }

  if (!data.user) {
    return null
  }

  return { user: data.user }
})

export const getCurrentUserRole = cache(async (): Promise<UserRole | null> => {
  const session = await verifySession()

  if (!session) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (error) {
    throw new Error(`user_roles lookup failed: ${error.message}`)
  }

  const roleRow = data as { role: UserRole } | null

  return roleRow?.role ?? null
})

export async function requireRole(rolesAllowed: UserRole[]): Promise<RequireRoleResult> {
  const [session, role] = await Promise.all([
    verifySession(),
    getCurrentUserRole(),
  ])

  if (session && role && rolesAllowed.includes(role)) {
    return {
      user: session.user,
      role,
      isLegacyBridge: false,
    }
  }

  if (!session && rolesAllowed.length === 1 && rolesAllowed[0] === 'admin' && await hasLegacyAdminSession()) {
    console.warn('[auth-bridge] 旧 Cookie 認証フォールバック使用 userId=legacy-admin')

    return {
      user: null,
      role: 'admin',
      isLegacyBridge: true,
    }
  }

  if (!session) {
    throw new Error('Unauthorized')
  }

  throw new Error('Forbidden')
}

export function isSafeReturnTo(returnTo: string) {
  return SAFE_RETURN_TO_PATTERN.test(returnTo)
}

export function sanitizeReturnTo(returnTo: string | null | undefined) {
  if (!returnTo) {
    return '/'
  }

  return isSafeReturnTo(returnTo) ? returnTo : '/'
}
