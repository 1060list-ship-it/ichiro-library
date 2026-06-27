import Link from 'next/link'

export const metadata = {
  title: 'このサービスについて | ichiro library',
}

export default function AboutPage() {
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
              About
            </p>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                ichiro library について
              </h1>
              <p className="text-sm leading-7 text-gray-300 sm:text-base">
                山口一郎（サカナクション）のYouTubeライブ配信を、あとから探せるようにするためのアーカイブサービスです。
              </p>
            </div>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">始まり</h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              配信を見返したい時に「あの話どの回だったっけ」と迷うことが多かったので、自分のために作りました。字幕を
              AI で解析して要約・タグ付けすることで、内容で検索できるようになっています。
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">できること</h2>
            <ul className="space-y-3 text-sm leading-7 text-gray-300 sm:text-base">
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <strong className="text-white">キーワード検索</strong> —
                タイトル・要約・ゲスト名など全文で検索
              </li>
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <strong className="text-white">カテゴリから探す</strong> —
                最新・再生数・ワイワイ・ライブビデオ解説などの切り口で配信を一覧できます
              </li>
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <strong className="text-white">年別フィルター</strong> —
                2022年から現在まで、年単位での絞り込み
              </li>
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <strong className="text-white">配信詳細</strong> —
                AI が生成したチャプター・ハイライト・要約・登場人物一覧
              </li>
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <strong className="text-white">週刊マガジン</strong> —
                週ごとの配信まとめを自動生成
              </li>
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <strong className="text-white">エンティティ検索</strong> —
                バンドメンバー・ゲスト名から関連配信を一覧表示
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-white">技術について</h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              YouTube Data API v3 で動画の情報と字幕を取得し、Google Gemini
              でAI要約・タグ付けを行っています。Next.js + Supabase で構築しています。
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-semibold text-white">注意事項</h2>
            <p className="text-sm leading-7 text-gray-300 sm:text-base">
              当サービスはファンが個人で運営しています。サカナクション、NF、所属事務所とは一切関係がありません。
            </p>
          </section>

          <section className="space-y-3">
            <Link
              href="/privacy"
              className="inline-flex items-center text-sm text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 transition hover:text-white hover:decoration-white/60"
            >
              プライバシーポリシー
            </Link>
          </section>
        </article>
      </div>
    </main>
  )
}
