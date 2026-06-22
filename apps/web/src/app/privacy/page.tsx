import Link from 'next/link'

export const metadata = {
  title: 'プライバシーポリシー | ichiro library',
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

export default function PrivacyPage() {
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
              Privacy Policy
            </p>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                ichiro library プライバシーポリシー
              </h1>
              <p className="text-sm text-gray-400">最終更新日：2026年6月22日</p>
            </div>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              1. プライバシーポリシーについて
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              ichiro library（以下「当サービス」）は、山口一郎（サカナクション）のYouTubeライブ配信アーカイブを検索・閲覧できる個人運営のサービスです。本ポリシーでは、当サービスが収集・利用する情報と、その取り扱い方針を説明します。
            </p>
          </section>

          <section className="space-y-5">
            <h2 className="text-xl font-semibold text-white">2. 収集する情報</h2>

            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="text-base font-semibold text-white">
                一般ユーザー（未登録）
              </h3>
              <p className="text-sm leading-7 text-gray-300 sm:text-base">
                一般ユーザーの個人情報は収集しません。検索ログは匿名形式（クエリ文字列と件数のみ）でサーバーに記録されます。
              </p>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="text-base font-semibold text-white">
                メンバー登録ユーザー（招待制ベータ）
              </h3>
              <p className="text-sm leading-7 text-gray-300 sm:text-base">
                メンバー登録時にメールアドレスのみを収集します。氏名・電話番号・決済情報は一切収集しません。
              </p>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="text-base font-semibold text-white">
                YouTubeコンテンツデータ
              </h3>
              <p className="text-sm leading-7 text-gray-300 sm:text-base">
                YouTube Data API v3 を通じて、動画のタイトル・配信日時・視聴数・字幕データを取得します。これらは当サービスのデータベースに保存され、検索・要約機能に利用します。個人を特定する情報は含まれません。
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">3. 情報の利用目的</h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              収集した情報は以下の目的にのみ使用します。
            </p>
            <ul className="space-y-2 pl-5 text-sm leading-7 text-gray-300 marker:text-gray-500 sm:text-base">
              <li>配信アーカイブの検索・閲覧機能の提供</li>
              <li>
                AI による配信内容の要約・タグ付け（字幕テキストを Google Gemini API に送信）
              </li>
              <li>サービスの品質向上・障害対応</li>
              <li>メンバー機能の認証・管理</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              4. YouTube サービスの利用について
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスは YouTube Data API Services を利用しています。YouTube のデータを利用するにあたり、以下のポリシーに準拠しています。
            </p>
            <ul className="space-y-2 pl-5 text-sm leading-7 text-gray-300 marker:text-gray-500 sm:text-base">
              <li>
                <ExternalLink href="https://www.youtube.com/t/terms">
                  YouTube 利用規約
                </ExternalLink>
              </li>
              <li>
                <ExternalLink href="https://policies.google.com/privacy">
                  Google プライバシーポリシー
                </ExternalLink>
              </li>
              <li>
                <ExternalLink href="https://developers.google.com/youtube/terms/api-services-tos">
                  YouTube API Services 利用規約
                </ExternalLink>
              </li>
            </ul>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              YouTube API を通じて取得したデータの利用・保存については、Google が定めるデータポリシーに従います。
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">
              5. 第三者サービスとの情報共有
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスは以下の外部サービスを利用しています。各社のプライバシーポリシーもあわせてご確認ください。
            </p>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm text-gray-300">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.16em] text-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">サービス</th>
                    <th className="px-4 py-3 font-medium">用途</th>
                    <th className="px-4 py-3 font-medium">プライバシーポリシー</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  <tr className="bg-white/[0.02]">
                    <td className="px-4 py-4 align-top">
                      Supabase（Supabase Inc.）
                    </td>
                    <td className="px-4 py-4 align-top">データベース・認証</td>
                    <td className="px-4 py-4 align-top">
                      <ExternalLink href="https://supabase.com/privacy">
                        https://supabase.com/privacy
                      </ExternalLink>
                    </td>
                  </tr>
                  <tr className="bg-white/[0.01]">
                    <td className="px-4 py-4 align-top">Vercel（Vercel Inc.）</td>
                    <td className="px-4 py-4 align-top">ホスティング・CDN</td>
                    <td className="px-4 py-4 align-top">
                      <ExternalLink href="https://vercel.com/legal/privacy-policy">
                        https://vercel.com/legal/privacy-policy
                      </ExternalLink>
                    </td>
                  </tr>
                  <tr className="bg-white/[0.02]">
                    <td className="px-4 py-4 align-top">
                      Google（YouTube Data API / Gemini API）
                    </td>
                    <td className="px-4 py-4 align-top">動画データ取得・AI要約</td>
                    <td className="px-4 py-4 align-top">
                      <ExternalLink href="https://policies.google.com/privacy">
                        https://policies.google.com/privacy
                      </ExternalLink>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              個人情報を広告目的で第三者に販売・提供することはありません。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              6. Cookie・アクセスログ
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスは基本機能の動作のために最小限の Cookie（セッション管理）を使用します。広告 Cookie・トラッキング Cookie は使用しません。Vercel のホスティング基盤によりアクセスログ（IPアドレス・User-Agent）が自動収集されますが、当サービス側での個別管理は行いません。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              7. 情報の保管・セキュリティ
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              収集した情報は Supabase（データセンター: 東京リージョン）に保存します。通信は HTTPS で暗号化されます。ただし、インターネット上での完全なセキュリティを保証するものではありません。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">8. ユーザーの権利</h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              メンバー登録ユーザーは、登録メールアドレスの確認・削除を下記連絡先にリクエストできます。リクエスト受領から30日以内に対応します。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">
              9. 本ポリシーの変更
            </h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              法令改正やサービス変更に伴い、予告なくポリシーを更新することがあります。重要な変更は当サービス上でお知らせします。
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-semibold text-white">10. お問い合わせ</h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              プライバシーに関するお問い合わせは下記までご連絡ください。
            </p>
            <p className="text-sm text-gray-300 sm:text-base">
              メールアドレス:{' '}
              <a
                href="mailto:1060list@gmail.com"
                className="text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 transition hover:text-white hover:decoration-white/60"
              >
                1060list@gmail.com
              </a>
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}
