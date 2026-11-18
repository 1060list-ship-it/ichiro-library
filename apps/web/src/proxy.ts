import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// auth.ts の SAFE_RETURN_TO_PATTERN と同一。proxy は Edge Runtime のため import 不可。
const SAFE_RETURN_TO_PATTERN = /^\/(?![\/\\])[\x20-\x5B\x5D-\x7E]*$/
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です')
}

function sanitizeReturnTo(raw: string | null): string {
  if (!raw || !SAFE_RETURN_TO_PATTERN.test(raw) || raw === '/login') return '/member'
  return raw
}

function hasSupabaseAuthCookie(cookies: { name: string; value: string }[]) {
  return cookies.some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token') && c.value.length > 0)
}

export default async function proxy(request: NextRequest) {
  let cookiesToApply: Array<{ name: string; value: string; options?: CookieOptions }> = []
  let response = NextResponse.next({
    request,
  })

  const applyResponseCookies = (target: NextResponse) => {
    for (const { name, value, options } of cookiesToApply) {
      target.cookies.set(name, value, options)
    }
    return target
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToApply = cookiesToSet.map(({ name, value, options }) => ({ name, value, options }))

        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }

        response = applyResponseCookies(NextResponse.next({
          request,
        }))
      },
    },
  })

  const { data } = await supabase.auth.getUser()

  const hasSessionCookie = Boolean(data.user) || hasSupabaseAuthCookie(request.cookies.getAll())

  const isMemberPath =
    request.nextUrl.pathname === '/member' || request.nextUrl.pathname.startsWith('/member/')
  const isAdminPath =
    request.nextUrl.pathname === '/admin' || request.nextUrl.pathname.startsWith('/admin/')
  const isLoginPath = request.nextUrl.pathname === '/login'
  const isMagazinePath =
    request.nextUrl.pathname === '/magazine' || request.nextUrl.pathname.startsWith('/magazine/')
  const isMagazineCover = request.nextUrl.pathname.startsWith('/magazine-covers/')
  const isSuperchatPath =
    request.nextUrl.pathname === '/superchat' || request.nextUrl.pathname.startsWith('/superchat/')

  if (isMagazinePath || isMagazineCover || isSuperchatPath) {
    // Unlike the existing optimistic cookie check, this boundary requires a
    // verified user and an administrator role, including for static covers.
    if (!data.user) {
      if (isMagazineCover) {
        const denied = new NextResponse(null, { status: 404 })
        denied.headers.set('Cache-Control', 'private, no-store')
        denied.headers.set('X-Robots-Tag', 'noindex, nofollow')
        return applyResponseCookies(denied)
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('return', `${request.nextUrl.pathname}${request.nextUrl.search}`)
      const redirect = applyResponseCookies(NextResponse.redirect(loginUrl))
      redirect.headers.set('Cache-Control', 'private, no-store')
      redirect.headers.set('X-Robots-Tag', 'noindex, nofollow')
      return redirect
    }
    const { data: role, error } = await supabase.from('user_roles')
      .select('role').eq('user_id', data.user.id).maybeSingle()
    if (error || role?.role !== 'admin') {
      const denied = new NextResponse(null, { status: 404 })
      denied.headers.set('Cache-Control', 'private, no-store')
      denied.headers.set('X-Robots-Tag', 'noindex, nofollow')
      return applyResponseCookies(denied)
    }
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  }

  if ((isMemberPath || isAdminPath) && !hasSessionCookie) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('return', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return applyResponseCookies(NextResponse.redirect(loginUrl))
  }

  if (isLoginPath && hasSessionCookie) {
    const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('return'))
    if ((returnTo === '/magazine' || returnTo.startsWith('/magazine/')) && !data.user) {
      return response
    }
    return applyResponseCookies(NextResponse.redirect(new URL(returnTo, request.url)))
  }

  return response
}

export const config = {
  matcher: ['/member/:path*', '/admin/:path*', '/login', '/magazine/:path*', '/magazine-covers/:path*', '/superchat/:path*'],
}
