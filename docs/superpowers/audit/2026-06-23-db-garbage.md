# ichiro-library DB・migration 旧設計ゴミ監査

**実施日**: 2026-06-23  
**対象**: `03_personal_projects/ichiro-library/supabase/migrations/*.sql` と `supabase/seed.sql`  
**設計基準**: `03_personal_projects/ichiro-library/docs/superpowers/specs/2026-06-21-member-auth-playlist-design.md`  
**補足**: 現行設計書（2026-06-21版）では RLS 一覧は Section 10 ではない。Section 3 内の「`authenticated` ロールの READ 権限」（約 300 行目）にある。Section 10 は追加パッケージ。

---

## サマリー

| 重要度 | 件数 |
|---|---:|
| 🔴 ブロッカー | 2 |
| 🟡 警告 | 3 |
| 🟢 軽微 | 1 |

最大の問題は migration 履歴が壊れていることだ。ローカルのファイル名と、2026-06-23 に `HOME=/private/tmp SUPABASE_DISABLE_TELEMETRY=1 supabase migration list` で確認した remote 側の適用履歴が一致しない。再構築の正本として信用できない。

---

## 🔴 ブロッカー

### 1. migration バージョン履歴が崩壊している

- 重要度: 🔴 ブロッカー
- ファイルパス:
  - `supabase/migrations/014_member_auth.sql`
  - `supabase/migrations/014_songs_singles.sql`
  - `supabase/migrations/20260622140345_015_transcript_snapshots.sql`
  - `supabase/migrations/20260622140345_016_chapters_snapshot_anchor.sql`
  - `supabase/migrations/20260622140345_017_tag_vocabulary.sql`
  - `supabase/migrations/20260622140345_018_pipeline_jobs_kind_check.sql`
- 問題の内容:
  - `014_` が 2 本ある。番号重複。
  - `015`〜`018` は見出し番号は別でも、Supabase の version prefix は全て `20260622140345` で衝突している。
  - CLI 確認では local は `014` が 2 行、`20260622140345` が 4 行として解釈され、remote 側は `20260621051354` / `20260621053543` / `20260621070012` / `20260621074645` / `20260622140415` / `20260622140416` / `20260622140417` / `20260622140418` という別履歴を持っていた。
  - つまり、今 repo にある migration 群だけでは remote DB の履歴を再現できない。`001`〜`018` という見た目自体がすでに正本ではない。
- 推奨アクション:
  - いまの local migration を本番へそのまま適用しない。
  - remote の実履歴を正本として取り直す。`supabase migration fetch` / `repair` 相当で履歴を揃える。
  - `014_songs_singles.sql` は schema migration ではなく seed 扱いに分離する。少なくとも独立した一意 version に移す。
  - `015`〜`018` は一意な version prefix に修復する。既存 remote に合わせること。手動リネームだけで済ませる設計ではない。

### 2. `streams.has_live_singing` / `streams.highlights` を作る migration が存在しない

- 重要度: 🔴 ブロッカー
- ファイルパス:
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/002_add_likes_songs_topics.sql`
  - `supabase/migrations/003_add_live_viewing_flag.sql`
  - `supabase/migrations/009_stream_started_at.sql`
  - `supabase/migrations/014_member_auth.sql`
  - 影響確認:
    - `apps/web/src/lib/types.ts:7-35`
    - `packages/pipeline/store.py:36-39`
    - `packages/pipeline/store.py:93-101`
    - `apps/web/src/app/page.tsx:166-169`
- 問題の内容:
  - migration 001〜018 のどこにも `has_live_singing` と `highlights` を追加する SQL がない。
  - だがアプリと pipeline はこの 2 列を前提に動いている。`store.py` は upsert 時に両方を書き込み、トップページは `has_live_singing = true` で絞り込む。
  - 新規環境で migration を頭から流すと、コードとスキーマが一致しない。空 DB 再構築、CI、検証環境で壊れる。
- 推奨アクション:
  - 新規 migration を追加し、`streams` に 2 列を正式追加する。
  - `highlights` の型を明文化する。現状のコード前提なら `JSONB` が妥当。
  - 既存データの backfill 方針を決める。`has_live_singing` は `NULL` or `false`、`highlights` は `NULL` or `[]` を明示する。

---

## 🟡 警告

### 3. `012` は欠番。実装は `014_member_auth.sql` に吸収されている

- 重要度: 🟡 警告
- ファイルパス:
  - `supabase/migrations/014_member_auth.sql:3-13`
  - `10_system/handoff/2026-06-21d-claude.md:76-80`
- 問題の内容:
  - handoff では「012 migration で `chapters_anon_read` 差し替え、`authenticated` への transcript REVOKE 追加」と記録されている。
  - 実ファイルには `012_*.sql` が存在しない。
  - ただし必要な SQL 自体は `014_member_auth.sql` に入っている。未実装ではない。履歴説明だけが壊れている。
- 推奨アクション:
  - `014_member_auth.sql` の先頭コメントか設計書追記で「旧 012 想定分をここへ吸収」と明記する。
  - handoff だけを正本にしない。設計書か migration header に寄せる。

### 4. `search_logs` は実装済みだが、正本が設計書ではなく handoff に分散している

- 重要度: 🟡 警告
- ファイルパス:
  - `supabase/migrations/014_member_auth.sql:272-292`
  - `10_system/handoff/2026-06-21d-claude.md:61-66`
  - `docs/superpowers/specs/2026-06-21-member-auth-playlist-design.md`
- 問題の内容:
  - `search_logs` は `014_member_auth.sql` に入っている。
  - だが 2026-06-21 の設計書本文には `search_logs` テーブル定義が統合されていない。要件は handoff 側だけにある。
  - その結果、「Section 10 の RLS 一覧」といった参照ズレが起きている。設計の SSoT が分裂している。
- 推奨アクション:
  - `search_logs` の定義・RLS・運用方針を設計書へ編入する。
  - 現行設計書の参照位置も修正する。RLS 一覧は Section 3 内だ。

### 5. `seed.sql` は 001 時代のまま。新設計の bootstrap として古い

- 重要度: 🟡 警告
- ファイルパス:
  - `supabase/seed.sql:1-2`
  - `supabase/seed.sql:7-120`
- 問題の内容:
  - ヘッダが「`001_initial_schema.sql` の後に実行」と書かれている。
  - 実体も `streams` / `chapters` / `ratings` だけで、`user_roles` / `playlists` / `playlist_streams` / `bookmarks` / `search_logs` の初期化を持たない。
  - データ内容自体が新設計と衝突しているわけではない。だが seed の説明と役割は旧設計のまま残っている。
- 推奨アクション:
  - ヘッダを更新する。少なくとも「全 migration 適用後」と書き換える。
  - member auth 用の最小 seed を別ファイルで持つ。`user_roles` 手動投入手順へのリンクでもいい。

---

## 🟢 軽微

### 6. `018_pipeline_jobs_kind_check.sql` は `011` の再掲で、実質差分がない

- 重要度: 🟢 軽微
- ファイルパス:
  - `supabase/migrations/011_pipeline_jobs_weekly_magazine.sql:1-5`
  - `supabase/migrations/20260622140345_018_pipeline_jobs_kind_check.sql:1-6`
- 問題の内容:
  - どちらも `pipeline_jobs.kind` の CHECK 制約を `('fetch_new', 'reprocess', 'reprocess_single', 'weekly_magazine')` に張り直している。
  - 018 は schema 差分として新情報を持っていない。履歴ノイズ。
- 推奨アクション:
  - remote 未適用なら整理対象。
  - remote 適用済みなら削除ではなく、履歴整合修復時に「なぜ再掲されたか」をコメントで残す。

---

## 確認結果

### 確認済み。未実装ではない

| 項目 | 結果 | 根拠 |
|---|---|---|
| `chapters_anon_read` が `USING(true)` のまま残っているか | いいえ | `014_member_auth.sql:4-9` で DROP & 再作成済み |
| `authenticated` への transcript REVOKE があるか | ある | `014_member_auth.sql:12-13` |
| `user_roles` があるか | ある | `014_member_auth.sql:55-69` |
| `playlists` があるか | ある | `014_member_auth.sql:71-96` |
| `bookmarks` があるか | ある | `014_member_auth.sql:122-139` |
| `search_logs` があるか | ある | `014_member_auth.sql:272-292` |

### 用語確認

| 項目 | 結果 |
|---|---|
| `playlist_items` テーブル | 存在しない |
| 現行の正本名 | `playlist_streams` |
| 根拠 | 設計書 Section 3 と `014_member_auth.sql:98-120` がともに `playlist_streams` を採用 |

`playlist_items` は少なくとも現 repo の設計書・migration・型定義には存在しない。現行命名は `playlist_streams` で統一されている。

---

## 優先順位

1. migration 履歴を remote 正本に合わせて修復する。ここを直さない限り replay が信用できない。
2. `has_live_singing` / `highlights` の欠落 migration を追加する。
3. `012` 欠番説明、`search_logs` の spec 反映、`seed.sql` 更新で文書と bootstrap を揃える。
