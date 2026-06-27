'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: '配信一覧' },
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
      </div>
    </header>
  )
}
