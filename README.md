# ichiro-library

山口一郎（サカナクション）YouTube ライブアーカイブ 検索システム

## Phase 1: Supabase セットアップ手順

### 1. Supabase プロジェクト作成

1. [https://supabase.com](https://supabase.com) にアクセスし、GitHub でログイン
2. **New Project** をクリック
3. 設定:
   - **Name**: `ichiro-library`
   - **Database Password**: 安全なパスワードを設定（保存しておくこと）
   - **Region**: `Northeast Asia (Tokyo)` 推奨
4. プロジェクト作成完了まで約1分待つ

### 2. DBスキーマ適用

1. Supabase ダッシュボード > **SQL Editor** > **New query**
2. `supabase/migrations/001_initial_schema.sql` の内容を貼り付けて **Run** をクリック
3. エラーがないことを確認

### 3. テストデータ投入（任意）

1. SQL Editor > New query
2. `supabase/seed.sql` の内容を貼り付けて **Run** をクリック
3. **Table Editor** で `streams`、`chapters`、`ratings` テーブルにデータが入っていることを確認

### 4. API キーの取得

1. Supabase ダッシュボード > **Settings** > **API**
2. 以下をコピーして `.env.local` に設定:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY`（秘密鍵：絶対にフロントエンドで使わない）

```bash
cp .env.local.example .env.local
# .env.local を編集して値を埋める
```

### 5. 動作確認 SQL

SQL Editor で以下を実行して検索 RPC が動くか確認:

```sql
-- 全件取得
SELECT * FROM streams ORDER BY stream_date DESC;

-- 検索RPC テスト
SELECT * FROM search_streams('音楽');

-- チャプター確認
SELECT c.*, s.title AS stream_title
FROM chapters c
JOIN streams s ON s.id = c.stream_id
ORDER BY s.stream_date DESC, c.sort_order;

-- 評価集計確認
SELECT title, avg_rating, rating_count FROM streams ORDER BY avg_rating DESC;
```

## ファイル構成

```
ichiro-library/
├── .env.local.example          # 環境変数テンプレート
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # DBスキーマ（テーブル・インデックス・RLS・RPC）
│   └── seed.sql                    # テストデータ
├── packages/
│   └── pipeline/               # データ収集パイプライン（Phase 2 で実装）
└── src/                        # Next.js フロントエンド（Phase 3 で実装）
```

## 開発フェーズ

| Phase | 内容 | 状態 |
|-------|------|------|
| **1** | Supabase DBスキーマ構築 | ✅ 完了 |
| **2** | 字幕取得 + Gemini 要約パイプライン（Python） | 未着手 |
| **3** | 検索UI（Next.js） | 未着手 |
| **4** | 管理画面 | 未着手 |
| **5** | 星評価 + ランキング | 未着手 |
| **6** | 自動巡回バッチ | 未着手 |
| **7** | Vercel デプロイ | 未着手 |
| **8** | 実データ運用テスト | 未着手 |
