# migration クリーン再生CI・ドリフト検知

対象: `supabase/migrations/*.sql` と本番Supabase（project ref: `tpgmbulgebcrmzbjvzwj`）
導入: 2026-09-24（TASKS.md「migration履歴とリモート実態のドリフト解消」の恒久対策）

## 背景

2026-07-11の調査で3種類のドリフトが確認された。

1. ローカルmigrationに追加処理が欠落（`has_live_singing` / `highlights`）
2. Dashboard/SQLエディタからの直接適用分がローカルにファイルとして存在しない（4件）
3. 同一versionの重複ファイル（029）

`014a_fix_column_grants.sql` は 1 が原因でクリーン再生が必ず失敗する状態のまま3週間気づかれなかった。
恒久対策として次の2つを機械化する（本番へは一切書き込まない）。

- **クリーン再生CI**: 空のローカルDBへ全migration + seedを再適用し、再生不能なmigrationをPR/push時に検出
- **ドリフト検知**: 本番migration履歴とローカルファイルのversionを週次突合し、直接適用・未適用・重複を検出

## 1. クリーン再生CI（`.github/workflows/migration-replay.yml`）

秘密情報を使わない（ローカルDockerのみ）。以下を実行する。

```bash
supabase db start        # ローカルスタック起動 + migration適用
supabase db reset --local # 空DBへ全migration + seedを再適用（本命の検証）
supabase db lint --local  # plpgsql等の型エラー検査
supabase test db --local  # supabase/tests/000_replay_smoke.sql（pgTAP）
```

`supabase/tests/000_replay_smoke.sql` は以下を固定する。

- `get_engagement_ranking` が実行できること（020の位置ベースcast回帰）
- `search_streams('音楽')` が実行できること（`014_member_auth` のシグネチャ）
- anonが `stream_reports` に INSERT できないこと（029）
- anonが `streams.transcript` を SELECT できないこと（014a/026）
- `pipeline_jobs` のCHECK制約が `whisper_transcribe` を許可すること（20260908063934）

ローカルで同じ検証を再現する手順:

```bash
cd <repo root>
supabase stop --no-backup
supabase db start
supabase db reset --local
supabase db lint --local
supabase test db --local
```

CLIバージョンはworkflow内で固定している（2026-09-24時点: `2.102.0`）。
更新する場合は上記のローカル手順を再実行し、合格を確認してからworkflowの `version` を上げる。

## 2. ドリフト検知（`.github/workflows/migration-drift.yml`）

`scripts/check_migration_drift.py`（標準ライブラリのみ・読み取り専用）が
Supabase Management API `GET /v1/projects/{ref}/database/migrations` を呼び、
本番の適用済みversionと `supabase/migrations/*.sql` のfilename prefixを突合する。

検出する状態:

- `remote_only`: 本番にあるがローカルに無い（Dashboard等からの直接適用の疑い）
- `local_only`: ローカルにあるが本番未適用
- `duplicates`: 同一version prefixのローカルファイルが複数
- `unparsable`: 数字prefixが無い `.sql`

`remote_only` については、同名のローカルファイルがある場合に
`GET /v1/projects/{ref}/database/migrations/{version}` の `statements` とローカルファイル内容を
正規化（コメント行・空白・末尾セミコロンの差を無視）して比較し、`match` / `differs` / `unavailable` を表示する。
`match` は「ローカルfilenameを本番versionに合わせれば整合する」ことの判断材料になる。

`supabase/local-only-migrations.txt` に列挙したversionは「意図的なローカル専用migration」として
ドリフト判定から除外し、レポートには理由付きの既知例外として表示する。追記時は
「なぜ本番へ適用しないのか・本番側の状態」を併記する。

週次（月曜 09:00 JST）+ 手動（workflow_dispatch）で実行し、ドリフトがあればworkflowが失敗する。

### 必要な設定（初回のみ・Owner作業）

1. Supabaseで `Migrations` の **Read** 権限（対象プロジェクト限定のスコープ付きトークン推奨）を発行する
2. GitHub リポジトリ `1060list-ship-it/ichiro-library` の Secrets に `SUPABASE_ACCESS_TOKEN` を登録する
3. （任意）Variables に `SUPABASE_PROJECT_REF` を登録する（未設定時は既定値 `tpgmbulgebcrmzbjvzwj`）
4. Actions タブから `Migration Drift Check` を `workflow_dispatch` で1回実行し、初回baselineを確認する

トークンが未登録の場合、workflowは「アクセストークンがありません」で失敗する（安全側）。
トークンには有効期限があるため、期限切れ前に再発行してSecretsを更新する（値はUIで一度しか表示されない）。

### ローカル実行

```bash
SUPABASE_ACCESS_TOKEN=<token> python3 scripts/check_migration_drift.py \
  --project-ref tpgmbulgebcrmzbjvzwj \
  --local-dir supabase/migrations \
  --local-only-file supabase/local-only-migrations.txt
```

終了コード: `0` ドリフトなし（既知例外のみ） / `1` ドリフト検出 / `2` 実行不能（トークン・API・ネットワーク）

ユニットテスト: `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`

## 3. ドリフト検出時の対応方針

- `remote_only`: レポートの内容比較が `match` なら、ローカルfilenameを**本番記録済みversionへrename**して整合させる（例: `20260718100000_034_drop_live_viewing_flag.sql` → `20260718024607_034_drop_live_viewing_flag.sql`。内容を変えずprefixのみ変更する）。`differs` の場合はrenameせず、本番で何が適用されたかを確認して一幾判断を仰ぐ。`supabase migration repair` は本番履歴への書き込みのため、従来どおり明示承認が必要
- `local_only`: 本番適用が必要か、`supabase/local-only-migrations.txt` へ既知例外として登録すべきかを確認する
- `duplicates`: `docs/audit/2026-06-24-migration-status.md` の原則（本番に記録済みのversionにローカルfilenameを合わせる）に反していないか確認する


## 関連

- `docs/audit/2026-06-24-migration-status.md`（migration履歴の正本記録）
- `docs/audit/2026-06-23-db-garbage.md`（履歴崩壊の発見経緯）
- TASKS.md「ichiro-library: migration履歴とリモート実態のドリフト解消」（AI_work側）
