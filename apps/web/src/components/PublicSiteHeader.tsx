'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const NAV_ITEMS = [
  { href: '/', label: '配信一覧' },
  { href: '/playlists', label: 'プレイリスト' },
  { href: '/magazine', label: 'マガジン' },
]

const HIDDEN_PREFIXES = ['/admin', '/login']
const HIDDEN_PATHS = new Set(['/member'])

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function PublicSiteHeader() {
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  useEffect(() => {
    let active = true

    const syncUser = async () => {
      const { data, error } = await supabase.auth.getUser()

      if (!active) {
        return
      }

      if (error) {
        console.error('PublicSiteHeader getUser failed', error)
        setIsAuthenticated(false)
        setIsAdmin(false)
        return
      }

      const authenticated = Boolean(data.user)
      setIsAuthenticated(authenticated)

      if (authenticated) {
        fetch('/api/role')
          .then((res) => res.json())
          .then((json: { role: string | null }) => {
            if (active) setIsAdmin(json.role === 'admin')
          })
          .catch(() => undefined)
      } else {
        setIsAdmin(false)
      }
    }

    void syncUser()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return
      }

      setIsAuthenticated(Boolean(session?.user))
      if (!session?.user) setIsAdmin(false)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [pathname])

  const handleLogout = async () => {
    setIsSigningOut(true)

    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('PublicSiteHeader signOut failed', error)
      setIsSigningOut(false)
      return
    }

    setIsAuthenticated(false)
    window.location.assign('/')
  }

  if (!pathname || HIDDEN_PATHS.has(pathname) || HIDDEN_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return null
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-800/80 bg-gray-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-[0.18em] text-white transition hover:text-gray-300">
          ichiro library
        </Link>

        <nav className="flex items-center gap-2">
          {NAV_ITEMS.map(item => {
            const active = isActivePath(pathname, item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-gray-950'
                    : 'bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          {isAuthenticated === false && (
            <Link
              href="/login"
              className="text-xs text-gray-500 transition-colors hover:text-gray-300"
            >
              ログイン
            </Link>
          )}

          {isAuthenticated === true && (
            <>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="rounded border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
                >
                  管理
                </Link>
              )}
              <button
                type="button"
                onClick={() => { void handleLogout() }}
                disabled={isSigningOut}
                className="text-xs text-gray-600 transition-colors hover:text-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ログアウト
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
