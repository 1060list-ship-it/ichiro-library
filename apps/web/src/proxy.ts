import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// auth.ts の SAFE_RETURN_TO_PATTERN と同一。proxy は Edge Runtime のため import 不可。
const SAFE_RETURN_TO_PATTERN = /^\/(?![\/\\])[\x20-\x5B\x5D-\x7E]*$/

function sanitizeReturnTo(raw: string | null): string {
  if (!raw || !SAFE_RETURN_TO_PATTERN.test(raw) || raw === '/login') return '/member'
  return raw
}

function hasSupabaseAuthCookie(cookies: { name: string; value: string }[]) {
  return cookies.some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
}

export default async function proxy(request: NextRequest) {
  const allCookies = request.cookies.getAll().map(({ name, value }) => ({ name, value }))
  const hasSessionCookie = hasSupabaseAuthCookie(allCookies)

  const isMemberPath =
    request.nextUrl.pathname === '/member' || request.nextUrl.pathname.startsWith('/member/')
  const isLoginPath = request.nextUrl.pathname === '/login'

  if (isMemberPath && !hasSessionCookie) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('return', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoginPath && hasSessionCookie) {
    const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('return'))
    return NextResponse.redirect(new URL(returnTo, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/member/:path*', '/login'],
}
