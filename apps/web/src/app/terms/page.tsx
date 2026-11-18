import Link from 'next/link'

export const metadata = {
  title: '利用規約 | ichiro library',
}

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 transition hover:text-white hover:decoration-white/60"
    >
      {children}
    </a>
  )
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12 text-gray-100">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-400 transition hover:text-white"
        >
          ← トップへ戻る
        </Link>

        <article className="mt-8 space-y-10">
          <header className="space-y-4 border-b border-white/10 pb-8">
            <p className="text-sm uppercase tracking-[0.24em] text-gray-500">
              Terms of Service
            </p>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                ichiro library 利用規約
              </h1>
              <p className="text-sm text-gray-400">最終更新日：2026年11月18日</p>
            </div>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              1. 本規約について
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              本規約は、ichiro library（以下「当サービス」）の利用条件を定めるものです。利用者は、本規約に同意した上で当サービスを利用するものとします。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              2. サービスの性質
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスは、山口一郎（サカナクション）のYouTubeライブ配信アーカイブを検索・閲覧できる個人運営の非公式ファンサイトです。山口一郎氏、サカナクション、各レーベル、YouTube および Google とは一切関係ありません。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              3. YouTube サービスの利用
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスは YouTube Data API を利用しています。当サービスの利用により、利用者は{' '}
              <ExternalLink href="https://www.youtube.com/t/terms">
                YouTube 利用規約
              </ExternalLink>
              に同意したものとみなされます。当サービスに表示される動画・音源・字幕等のコンテンツの権利は、YouTube および各権利者に帰属します。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              4. 知的財産権
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスに表示される動画・要約・字幕等に関する著作権は、各権利者に帰属します。当サービスは、情報検索および私的利用の範囲でこれらを参照・表示します。権利者の意思に反する利用を助長するものではありません。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              5. 会員機能
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              会員機能の利用にはメールアドレスによる登録が必要です。会員は、自己の責任において認証情報を管理するものとします。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              6. 禁止事項
            </h2>
            <ul className="space-y-2 pl-5 text-sm leading-7 text-gray-300 marker:text-gray-500 sm:text-base">
              <li>法令または公序良俗に違反する行為</li>
              <li>当サービスに対するスクレイピング等の自動的なアクセス</li>
              <li>他の利用者または当サービスの運営を妨害する行為</li>
              <li>当サービスのデータを権利者の許諾なく再配布する行為</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              7. 免責事項
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスは無償で提供され、その可用性・正確性・完全性について一切保証しません。当サービスの利用により利用者に生じた損害について、運営者は責任を負いません。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              8. 本規約の変更
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              運営者は、予告なく本規約を変更することがあります。重要な変更は当サービス上でお知らせします。
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-semibold text-white">
              プライバシーについて
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              情報の取り扱いについては
              <Link
                href="/privacy"
                className="text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 transition hover:text-white hover:decoration-white/60"
              >
                プライバシーポリシー
              </Link>
              をご確認ください。
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}
