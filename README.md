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

## Phase 4: パイプラインジョブ運用

### `pipeline_jobs` migration の適用

1. Supabase ダッシュボードの **SQL Editor** を開く
2. `supabase/migrations/004_pipeline_jobs.sql` の内容を貼り付けて実行
3. `pipeline_jobs` テーブルと `idx_pipeline_jobs_pending` が作成されたことを確認

### worker の手動実行

```bash
cd packages/pipeline
python worker.py
```

ジョブを安全に確認だけしたい場合:

```bash
cd packages/pipeline
python worker.py --dry-run
```

### cron 登録例

```bash
# 15分ごとに worker.py を実行
*/15 * * * * cd /path/to/ichiro-library/packages/pipeline && python worker.py >> /tmp/ichiro-worker.log 2>&1
```

### 日曜深夜のマガジン自動生成

毎週日曜 23:30 に `weekly_magazine` ジョブをキューに投入し、worker.py が処理する。

```bash
# crontab -e で以下を追加

# 毎週日曜 23:30 にマガジン生成ジョブをキューに登録
30 23 * * 0 cd /path/to/ichiro-library/packages/pipeline && python -c "from store import get_supabase_client; client = get_supabase_client(); client.table('pipeline_jobs').insert({'kind': 'weekly_magazine'}).execute(); print('weekly_magazine job enqueued')" >> /tmp/ichiro-enqueue.log 2>&1

# worker.py はすでに */15 で動いているので自動的に処理される
```

または管理画面の「今週のマガジンを生成」ボタンから手動実行も可能。

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
