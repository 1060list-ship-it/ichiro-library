import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient, hasSupabaseAuthCookie } from '@/lib/supabase-server'

const LEGACY_ADMIN_COOKIE_NAME = 'ichiro-library-admin'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next()

  const supabase = await createSupabaseServerClient({
    cookies: {
      getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }

        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        })

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }

        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value)
        }
      },
    },
  })

  await supabase.auth.getUser()

  const hasLegacyAdminCookie = request.cookies.has(LEGACY_ADMIN_COOKIE_NAME)
  const hasSessionCookie = hasSupabaseAuthCookie(
    request.cookies.getAll().map(({ name, value }) => ({ name, value })),
  )
  const isMemberPath = request.nextUrl.pathname === '/member' || request.nextUrl.pathname.startsWith('/member/')
  const isLoginPath = request.nextUrl.pathname === '/login'

  if (isMemberPath && !hasLegacyAdminCookie && !hasSessionCookie) {
    const loginUrl = new URL('/login', request.url)
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`

    loginUrl.searchParams.set('return', returnTo)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoginPath && (hasLegacyAdminCookie || hasSessionCookie)) {
    return NextResponse.redirect(new URL('/member', request.url))
  }

  return response
}

export const config = {
  matcher: ['/member/:path*', '/login'],
}
