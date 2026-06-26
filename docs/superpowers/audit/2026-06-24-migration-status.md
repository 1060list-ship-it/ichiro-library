# ichiro-library migration status

**確認日**: 2026-06-25  
**対象**: `supabase/migrations/*.sql` と Supabase 本番 `schema_migrations`  
**確認方法**:
- `supabase migration list --linked`
- Supabase MCP `list_migrations`

## 結論

- `014_member_auth` と `014_songs_singles` は本番 `schema_migrations` に**両方記録済み**。
- 危険なのは「ローカル名を任意の新しい version に変えて `supabase db push` する」ことだ。CLI は filename prefix を migration version として扱う。未記録 version に変えると**新規 migration** とみなされ、SQL 再実行のリスクがある。
- 安全なのは「**本番に記録済みの version にローカル filename を合わせるだけ**」だ。SQL 本文は変えない。history table と local files を一致させる。
- 今回は 014 だけでなく 013 / 015 / 016 / 017 / 018 / 019 も本番履歴とズレていたため、まとめて filename を修正した。

## 本番 migration 履歴

| Version | Name | 本番適用時刻 (UTC) | ローカル状態 |
|---|---|---|---|
| 001 | initial_schema | 001 | 一致 |
| 002 | add_likes_songs_topics | 002 | 一致 |
| 003 | add_live_viewing_flag | 003 | 一致 |
| 004 | pipeline_jobs | 004 | 一致 |
| 005 | magazines | 005 | 一致 |
| 006 | magazine_cover | 006 | 一致 |
| 007 | entities | 007 | 一致 |
| 008 | entity_links | 008 | 一致 |
| 009 | stream_started_at | 009 | 一致 |
| 010 | magazine_issue_number | 010 | 一致 |
| 011 | pipeline_jobs_weekly_magazine | 011 | 一致 |
| 20260621051354 | 013_songs | 2026-06-21 05:13:54 | 修正済み |
| 20260621053543 | 014_songs_singles | 2026-06-21 05:35:43 | 修正済み |
| 20260621070012 | 014_member_auth | 2026-06-21 07:00:12 | 修正済み |
| 20260621074645 | 014a_fix_column_grants | 2026-06-21 07:46:45 | 一致 |
| 20260622140415 | 015_transcript_snapshots | 2026-06-22 14:04:15 | 修正済み |
| 20260622140416 | 016_chapters_snapshot_anchor | 2026-06-22 14:04:16 | 修正済み |
| 20260622140417 | 017_tag_vocabulary | 2026-06-22 14:04:17 | 修正済み |
| 20260622140418 | 018_pipeline_jobs_kind_check | 2026-06-22 14:04:18 | 修正済み |
| 20260624000001 | 020_engagement_ranking_rpc | 2026-06-24 00:00:01 | 一致 |
| 20260624043716 | 019_playlists_extension | 2026-06-24 04:37:16 | 修正済み |

## 実施したローカル修正

| 旧 filename | 新 filename |
|---|---|
| `013_songs.sql` | `20260621051354_013_songs.sql` |
| `014_songs_singles.sql` | `20260621053543_014_songs_singles.sql` |
| `014_member_auth.sql` | `20260621070012_014_member_auth.sql` |
| `20260622140345_015_transcript_snapshots.sql` | `20260622140415_015_transcript_snapshots.sql` |
| `20260622140345_016_chapters_snapshot_anchor.sql` | `20260622140416_016_chapters_snapshot_anchor.sql` |
| `20260622140345_017_tag_vocabulary.sql` | `20260622140417_017_tag_vocabulary.sql` |
| `20260622140345_018_pipeline_jobs_kind_check.sql` | `20260622140418_018_pipeline_jobs_kind_check.sql` |
| `20260624000000_019_playlists_extension.sql` | `20260624043716_019_playlists_extension.sql` |

## 014 重複に対する判断

- `014` の重複そのものは危険だった。
- ただし本番ではすでに `014_songs_singles` と `014_member_auth` が**別 version**で記録されている。
- したがって、いま必要なのは本番履歴を壊すことではなく、ローカル filename を本番 version に寄せることだ。
- `20260621000000_...` のような**推測 timestamp へのリネームは採用しない**。本番履歴に存在しないため危険。

## 019 / 020 の内容と本番反映状況

### 20260624043716_019_playlists_extension.sql

- `playlist_entities` テーブル追加
- `search_logs` の `query` / `result_count` を `NOT NULL` に強化
- `search_logs_admin_read` policy を作り直し
- `playlist_streams` の公開 / authenticated read policy を作り直し

**本番**: 適用済み。version は `20260624043716`。

### 20260624000001_020_engagement_ranking_rpc.sql

- `public.get_engagement_ranking(limit_n, date_from, date_to)` RPC を作成
- `streams` の engagement ratio で降順ソート
- `EXECUTE` を `anon, authenticated` に付与
- `NOTIFY pgrst, 'reload schema'` 実行

**本番**: 適用済み。version は `20260624000001`。

## 検証結果

- `supabase migration list --linked` では local / remote が全件一致した。
- `supabase db push --linked --dry-run` は、この環境では temp role の DB password 認証失敗で最後まで完走していない。
- ただし、修正前に出ていた `Remote migration versions not found in local migrations directory` は解消した。history mismatch は直っている。

## 補足

- この repo には `CONTRIBUTING.md` が存在しない。今回の判断根拠はこのファイルを正本として残す。
- 今後 migration を追加するときは、作成直後の filename prefix を後から推測で触らない。必要なら本番適用後の `supabase migration list --linked` を基準に合わせる。
