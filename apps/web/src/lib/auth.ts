import 'server-only'

import { redirect } from 'next/navigation'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from './supabase-admin'
import { createSupabaseServerClient } from './supabase-server'
import type { UserRole } from './types'

const SAFE_RETURN_TO_PATTERN = /^\/(?![\/\\])[\x20-\x5B\x5D-\x7E]*$/

type VerifiedSession = {
  user: User
}

export type RequireRoleResult = {
  user: User
  role: UserRole
}

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
    return { user: session.user, role }
  }

  if (!session) {
    throw new Error('Unauthorized')
  }

  throw new Error('Forbidden')
}

export async function requireRoleOrRedirect(
  rolesAllowed: UserRole[],
  returnTo: string,
): Promise<RequireRoleResult> {
  try {
    return await requireRole(rolesAllowed)
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      redirect('/login?return=' + returnTo)
    }
    throw error
  }
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
