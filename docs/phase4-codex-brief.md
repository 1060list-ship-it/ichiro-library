# ichiro-library Phase 4 実装指示書（Codex向け）

> 設計確定者: kusanagi (Claude Code) — 2026-05-17  
> 実装担当: Codex (gpt-5.4 high)  
> リポジトリルート: `ichiro-library/` （このファイルの2つ上）

## 目的

管理画面から YouTube 動画の新規取り込み・再処理をトリガーできるようにする。  
**Vercel Serverless 上では Python を実行できない**ため、ジョブキュー方式を採用する。

```
管理画面ボタン
  → Server Action → pipeline_jobs テーブルに INSERT
    → ローカルcron（15分毎） → worker.py がポーリング
      → 既存スクリプトを呼び出して処理
        → pipeline_jobs に結果を書き戻す
          → 管理画面が status を表示
```

---

## 現状の確認（読むこと）

- 管理画面: `apps/web/src/app/admin/AdminPageClient.tsx`
- Server Actions: `apps/web/src/app/admin/actions.ts`（認証・CRUD・graceful fallback実装済み）
- パイプライン: `packages/pipeline/`
  - `batch_runner.py`: `run_batch(dry_run, days, max_videos)` を提供
  - `reprocess_videos.py`: `run(dry_run, target_video_id)` を提供
- Next.js 破壊的変更あり → 実装前に `apps/web/node_modules/next/dist/docs/` を参照せよ

---

## タスク一覧（順番通りに実施）

### タスク1: `pipeline_jobs` テーブル migration

**ファイル:** `supabase/migrations/002_pipeline_jobs.sql`

```sql
CREATE TABLE pipeline_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('fetch_new', 'reprocess', 'reprocess_single')),
  video_id     TEXT,
  payload      JSONB,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  error_msg    TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_jobs_pending
  ON pipeline_jobs(status, requested_at)
  WHERE status = 'pending';

-- RLS: 管理者（service_role）のみ操作可
ALTER TABLE pipeline_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role only" ON pipeline_jobs
  USING (auth.role() = 'service_role');
```

Supabase ダッシュボードの SQL Editor で実行する。

---

### タスク2: `packages/pipeline/worker.py`

**概要:** `pipeline_jobs` の `pending` ジョブをポーリングして既存スクリプトを呼び出す。

**実装要件:**
- `supabase-py` で `pipeline_jobs` を `SELECT ... WHERE status='pending' ORDER BY requested_at LIMIT 1`
- ジョブ取得後すぐ `status='running'`, `started_at=now()` に UPDATE
- `kind` で分岐:
  - `fetch_new`: `batch_runner.run_batch(days=payload.get('days', 30), max_videos=payload.get('max_videos', 20))`
  - `reprocess`: `reprocess_videos.run()`
  - `reprocess_single`: `reprocess_videos.run(target_video_id=video_id)`
- 成功 → `status='done'`, `finished_at=now()` に UPDATE
- 例外 → `status='failed'`, `error_msg=str(e)`, `finished_at=now()` に UPDATE
- `.env` の読み込みは `packages/pipeline/` 内の他スクリプト同様 `python-dotenv` を使う
- ログ出力は既存スクリプトと同様 `logging` を使う

**cron 登録例（READMEに追記すること）:**
```bash
# 15分ごとにworker.pyを実行
*/15 * * * * cd /path/to/ichiro-library/packages/pipeline && python worker.py >> /tmp/ichiro-worker.log 2>&1
```

---

### タスク3: Server Actions に `enqueueJob` 追加

**ファイル:** `apps/web/src/app/admin/actions.ts` に追記

```typescript
export type EnqueueJobInput =
  | { kind: 'fetch_new'; days?: number; maxVideos?: number }
  | { kind: 'reprocess' }
  | { kind: 'reprocess_single'; videoId: string }

export type PipelineJob = {
  id: string
  kind: string
  video_id: string | null
  payload: Record<string, unknown> | null
  status: string
  error_msg: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
}

export async function enqueueJob(input: EnqueueJobInput): Promise<PipelineJob> {
  await requireAdminSession()

  const row = {
    kind: input.kind,
    video_id: input.kind === 'reprocess_single' ? input.videoId : null,
    payload: input.kind === 'fetch_new'
      ? { days: input.days ?? 30, max_videos: input.maxVideos ?? 20 }
      : null,
  }

  const { data, error } = await supabaseAdmin
    .from('pipeline_jobs')
    .insert(row)
    .select()
    .single()

  if (error) throw error
  return data as PipelineJob
}

export async function fetchRecentJobs(limit = 10): Promise<PipelineJob[]> {
  await requireAdminSession()

  const { data, error } = await supabaseAdmin
    .from('pipeline_jobs')
    .select()
    .order('requested_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as PipelineJob[]
}
```

---

### タスク4: 管理画面にトリガーボタン追加

**ファイル:** `apps/web/src/app/admin/AdminPageClient.tsx`

既存のダッシュボードセクションに「パイプライン操作」セクションを追加する。

**UI 要件:**
- 「新規動画を取り込む」ボタン → `enqueueJob({ kind: 'fetch_new', days: 30, maxVideos: 20 })`
- 「transcript_failed を一括再処理」ボタン → `enqueueJob({ kind: 'reprocess' })`
- ボタン押下後: `isPending` 状態でスピナー表示、成功後にjobs一覧を更新
- 確認ダイアログ不要（即時enqueue）

---

### タスク5: jobs一覧セクション追加

**ファイル:** `apps/web/src/app/admin/AdminPageClient.tsx`

トリガーボタンの下にjobs一覧テーブルを追加する。

**UI 要件:**
- `fetchRecentJobs(10)` で最新10件を表示
- カラム: 種別（kind）・status・requested_at・started_at・finished_at・error_msg
- status バッジ: `pending`=グレー / `running`=黄色アニメ / `done`=緑 / `failed`=赤
- 30秒ごとに自動ポーリング（`setInterval`）または手動リフレッシュボタン
- `failed` 行は `error_msg` をホバーで表示（`title` 属性で可）

---

### タスク6: 技術的債務の修正

**`useEffectEvent` の削除（`apps/web/src/app/admin/AdminPageClient.tsx`）:**
- `useEffectEvent` は React 19 Experimental API。`useEffect` + `useCallback` に書き直す
- `setTimeout(..., 0)` でのworkaround も合わせて削除

**検索 `<form>` 構造の分離（同ファイル）:**
- 検索フォームの `<form>` の中に結果一覧が含まれている構造を分離する
- フォームは検索入力と送信ボタンのみを含む範囲に限定する

---

## 重要な制約・注意事項

1. **Secret の扱い:** `.env.local` の値はログ・コメント・出力に絶対に出力しない（`AGENTS.md` の制約）
2. **Server Actions の認証:** 既存の `requireAdminSession()` を必ず冒頭で呼ぶ
3. **`supabaseAdmin` の使用:** `pipeline_jobs` の操作は全て `supabaseAdmin`（service_role）を使う
4. **Next.js 版:** `apps/web/node_modules/next/dist/docs/` を参照してから書くこと
5. **Python 3.9 互換:** `worker.py` で型ヒントを使う場合は `Optional[X]` を使う（`X | None` は 3.10以降）
6. **既存スクリプトを変更しない:** `batch_runner.py`, `reprocess_videos.py` の関数シグネチャは変えるな
7. **`pipeline_jobs` のRLS:** service_role キーでのみ操作。フロントエンドの anon key では触れない

---

## 完了確認チェックリスト

- [ ] `supabase/migrations/002_pipeline_jobs.sql` 作成・Supabaseダッシュボードで適用
- [ ] `packages/pipeline/worker.py` 実装・ローカルで `python worker.py` を手動実行してジョブが処理されることを確認
- [ ] `enqueueJob` / `fetchRecentJobs` Server Action 追加
- [ ] 管理画面でトリガーボタンを押してSupabaseにレコードが入ることを確認
- [ ] jobs一覧が管理画面に表示されることを確認
- [ ] `useEffectEvent` が削除されていることを確認（grep で検索）
- [ ] 検索フォーム構造が分離されていることを確認
- [ ] `README.md` に cron 登録手順を追記
