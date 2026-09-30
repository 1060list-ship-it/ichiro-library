'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const NAV_ITEMS = [
  { href: '/', label: '配信一覧' },
  { href: '/magazine', label: 'マガジン' },
  { href: '/playlists', label: 'プレイリスト' },
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
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--canvas)_90%,transparent)] backdrop-blur">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
        <Link href="/" className="leading-none transition hover:opacity-80">
          <span className="block text-sm font-semibold tracking-[-0.02em]"><span className="text-[var(--ink)]">ichiro</span> <span className="text-[var(--aqua)]">library</span></span>
          <span className="mt-1 block text-[9px] font-medium tracking-[0.14em] text-[var(--muted)]">LIVE ARCHIVE</span>
        </Link>

        <nav className="order-3 col-span-2 -mx-4 grid grid-cols-3 sm:order-none sm:col-span-1 sm:mx-0 sm:flex sm:justify-center sm:gap-5" aria-label="主要ナビゲーション">
          {NAV_ITEMS.map(item => {
            const active = isActivePath(pathname, item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-11 items-center justify-center border-b-2 px-2 text-xs font-medium transition-colors sm:h-9 sm:px-0 ${
                  active
                    ? 'border-[var(--aqua)] text-[var(--ink)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center justify-end gap-3">
          {isAuthenticated === false && (
            <Link
              href="/login"
              className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              ログイン
            </Link>
          )}

          {isAuthenticated === true && (
            <>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="border-b border-[var(--line)] px-1 py-1 text-xs text-[var(--muted)] transition-colors hover:border-[var(--aqua)] hover:text-[var(--ink)]"
                >
                  管理
                </Link>
              )}
              <button
                type="button"
                onClick={() => { void handleLogout() }}
                disabled={isSigningOut}
                className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
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
