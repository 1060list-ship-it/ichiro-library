import Link from 'next/link'
import { sanitizeReturnTo } from '@/lib/auth'
import LoginForm from './LoginForm'

type PageProps = {
  searchParams: Promise<{
    return?: string | string[]
  }>
}

function getReturnTo(value: string | string[] | undefined) {
  return sanitizeReturnTo(Array.isArray(value) ? value[0] : value)
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { return: rawReturnTo } = await searchParams
  const returnTo = getReturnTo(rawReturnTo)

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-10">
        <div className="grid w-full max-w-4xl gap-8 rounded-[28px] border border-gray-800 bg-gray-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur md:grid-cols-[1.1fr_0.9fr] md:p-8">
          <section className="flex flex-col justify-between rounded-[22px] border border-gray-800 bg-gradient-to-br from-gray-950 via-gray-950 to-indigo-950/40 p-6">
            <div className="space-y-5">
              <div className="inline-flex w-fit rounded-full border border-indigo-900/80 bg-indigo-950/40 px-3 py-1 text-xs font-medium text-indigo-200">
                member access
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
                  ichiro library
                </h1>
                <p className="max-w-md text-sm leading-7 text-gray-300">
                  プレイリスト編集とメンバー機能はここから。余計な飾りはないが、触り心地は落とさない。
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-3 text-sm text-gray-400">
              <p>ログイン後の遷移先: <span className="text-gray-200">{returnTo}</span></p>
              <Link href="/" className="inline-flex text-indigo-300 transition hover:text-indigo-200">
                ← トップへ戻る
              </Link>
            </div>
          </section>

          <section className="rounded-[22px] border border-gray-800 bg-gray-900 p-6 md:p-7">
            <div className="mb-6 space-y-2">
              <h2 className="text-2xl font-semibold text-white">ログイン</h2>
              <p className="text-sm leading-6 text-gray-400">
                登録済みのメールアドレスとパスワードでサインインしてください。
              </p>
            </div>

            <LoginForm returnTo={returnTo} />
          </section>
        </div>
      </div>
    </main>
  )
}
