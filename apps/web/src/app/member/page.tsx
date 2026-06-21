import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { logoutAction } from './actions'
import MemberPageClient from './MemberPageClient'

export default async function MemberPage() {
  let session

  try {
    session = await requireRole(['editor', 'admin'])
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'Unauthorized' || error.message === 'Forbidden')
    ) {
      redirect('/login?return=/member')
    }

    throw error
  }

  const email = session.user?.email ?? 'unknown'

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 md:px-6 md:py-8">
        <header className="flex flex-col gap-4 rounded-[28px] border border-gray-800 bg-gray-900 p-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="text-sm text-gray-400 transition hover:text-white"
              >
                ← トップへ戻る
              </Link>
              <span className="rounded-full border border-indigo-900/80 bg-indigo-950/40 px-3 py-1 text-xs font-medium text-indigo-200">
                member area
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                Member Console
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-gray-400">
                編集用の土台だけ先に通した。ここからプレイリストとブックマークを積み上げる。
              </p>
            </div>

            <dl className="grid gap-3 text-sm text-gray-300 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  role
                </dt>
                <dd className="mt-2 text-base font-medium text-white">{session.role}</dd>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                  email
                </dt>
                <dd className="mt-2 break-all text-base font-medium text-white">{email}</dd>
              </div>
            </dl>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              ログアウト
            </button>
          </form>
        </header>

        <div className="mt-6">
          <MemberPageClient />
        </div>
      </div>
    </main>
  )
}
