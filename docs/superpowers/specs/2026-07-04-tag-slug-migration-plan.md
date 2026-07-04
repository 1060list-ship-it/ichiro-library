# タグslug化・全件再処理 改訂計画（第3版・レビュー指摘反映）

作成: 2026-07-04 / 前版へのレビュー: kana 2回目クリティカルレビュー（2026-07-02）・kiyotaka プロジェクトリスクレビュー（2026-07-02）
関連: `10_system/debate/2026-07-04_ichiro-reprocess-resume.md`（冪等再開機構の相互査問・並行トラック）

---

## 1. 目的

- Geminiが生成するタグを `tag_vocabulary` の slug に統一し、自由タグの混入をゼロにする
- 全304件の再処理を、中断・再実行しても二重処理にならない冪等な手順で完了させる

## 2. 現状実測（2026-07-04 Supabase 実DB）

| 項目 | 実測値 |
|---|---|
| 総配信数 | 304件（transcript有 303件） |
| `ai_prompt_ver` | v3=291件 / null=13件（6月分と7月分が区別不能） |
| 統制語彙外タグ出現数 | 2016件（山口一郎110・サカナクション86 等） |
| tag_vocabulary | 28語彙。うち casual_talk / fan_interaction / relationships はプロンプト除外済みなのに `is_active=true` のまま |
| snapshot方式chaptersを持つstream | 64件（7月処理分の痕跡） |
| 物理構造 | **chapters=独立テーブル / highlights=streamsテーブルのカラム** |
| 字幕長 | 平均 26,139字 / 最大 88,337字 |
| is_reviewed | 0件（＝全件が上書き対象。スキップ保護は働かない） |
| bookmarks | 1件（タグ文字列は非保存） |

## 3. レビュー指摘との対応表

| 指摘 | 反映先 |
|---|---|
| kana 死角1: slug化が出力例だけに矮小化 | P1（語彙リスト本体28→25語彙をslug＋日本語併記、出力はslugのみ） |
| kana 死角2: フロント先行デプロイでタグ表示が壊れる | P2（`map.get(tag) ?? tag` フォールバック必須、実装完了までデプロイ禁止） |
| kana 死角3: ブックマーク後方互換は空論点 | タスク削除（§8） |
| kana 懸念A: 事後SQL検証 | P6（語彙外タグ 2016→0 の確認クエリ） |
| kana 懸念B: 304件全上書き・バックアップ重要度up | P4（承認ゲート＋クリア直前バックアップ） |
| kana 懸念C: バックアップ定義の二重・順序矛盾 | P4に一本化（クリア直前の1回のみ） |
| kana 懸念D: バックアップ対象の物理構造が不明確 | §2に実測記載（chapters=テーブル / highlights=カラム） |
| kiyotaka 1: ROI/コスト試算欠如 | P5（5件パイロットで実測→304件換算→承認） |
| kiyotaka 2: 429再開ロジック不在 | P0（バージョン刻印方式・debate査問中） |
| kiyotaka 3: 不可逆操作の承認ゲートなし | P4（一幾の明示GOなしにクリア実行不可） |
| kiyotaka 4: マガジン発行と処理の衝突 | §7（マガジンcronは意図的停止中。再開は取り込み完了後に一幾GO＝衝突なし） |
| kiyotaka 5: ichiro_status.md 反映が未接続 | P0の自動反映機構（P6で検証） |

## 4. フェーズ構成

### P0: 冪等再開機構（並行トラック・debate査問中）

- 処理済み判定を `ai_prompt_ver <> 'v4'` によるバージョン刻印方式へ変更。フラグなし再実行で必ず続きから
- 進捗の `10_system/status/ichiro_status.md` 自動反映・`docs/PROJECT_STATE.md` 新設
- 詳細・リスクは debate ファイル参照。**CRITIQUE反映後に実装**（Codex担当）

### P1: v4プロンプト作成＋サーバー側ガード（完了・2026-07-04）

- 語彙リスト本体（v3.txt 67〜89行相当）を **slug（日本語ラベル）併記** に書き換え。出力はslugのみと明示
- 対象は is_active な25語彙（casual_talk / fan_interaction / relationships は掲載しない）
- 出力例（190行相当）の `"tags": ["音楽制作", "ゲスト", "雑談"]` を `"tags": ["music_production", "guest"]` に修正（「雑談」残存の除去）
- **タグ節以外は変更しない**（チャプター・要約の品質を7月処理分と同等に保ち、§6の救済を成立させるため）
- **kana実装前レビューで追加判明した死角**: プロンプト側の指示だけではGeminiの出力遵守を保証できない（語彙外タグ2016件混入の実績あり）。`store.py` の `row["tags"] = ai_result.get("tags", [])` が無検証だった
- **対応**: `store.py` に `normalize_tags(client, raw_tags)` を追加。`tag_vocabulary`（is_active）のslug集合・label→slug辞書と照合し、slug採用／label→slug変換／語彙外は破棄＋warningログ、を実施。`upsert_stream()` の書き込み直前に適用
- 実装: memcho / テスト11件（togusa・全体39 passed）/ 独立検証: fuchikoma「検証OK」（2026-07-04）
- 成果物: `packages/pipeline/prompts/v4.txt`（新規）・`packages/pipeline/store.py`（変更）・`packages/pipeline/tests/test_store_tags.py`（新規）。**未コミット**（一幾確認待ち）

### P2: フロントエンド対応（完了・2026-07-04）

- `tag-labels.ts`（slug→日本語表示マップ）に **`map.get(tag) ?? tag` フォールバック必須**
- フォールバックがあれば移行期間中（slug/日本語混在）も表示が壊れないため、フロントは再処理より先にデプロイしてよい。**フォールバックなしの先行デプロイは禁止**
- タグクリック絞り込み（Phase 2 UIタスク）はslug統一完了後に着手
- **kana実装前レビュー指摘**: (1) slug→label対応がv4.txt/DB/tag-labels.tsの3箇所に分散するリスク→28件完全一致を検証するテストで鮮度を保証 (2) フォールバックは安全だが対応表更新漏れ時は英語slugがそのまま表示される仕様である旨、一幾に事前確認・承認済み (3) 表示はgetTagLabel()で変換するが絞り込みキーは生値のまま→Phase 2で孤児タグ化するリスクを申し送りコメントとして両ファイルに明記
- 実装: paz / 独立検証: fuchikoma「検証OK」（fuchikomaが誤検出した1件のplaywright実行方法の齟齬はClaudeが再現確認し、pazの申告が正確だったことを確認済み）
- 成果物: `apps/web/src/lib/tag-labels.ts`（新規）・`apps/web/src/components/StreamCard.tsx`（変更）・`apps/web/src/app/stream/[id]/page.tsx`（変更）・`apps/web/tests/tag-labels.spec.ts`（新規）

### P3: DB整備（マイグレーション・完了・2026-07-04）

- `tag_vocabulary`: casual_talk / fan_interaction / relationships を `is_active=false` に更新
- migration017 の COMMENT に残る架空slug（music_talk / late_night）を実在語彙に修正
- **kana実装前レビュー指摘（2026-07-04）**: migration017ファイル自体は適用済みのため直接書き換え禁止（`supabase db push`のチェックサム照合でドリフト検知＝事故る）。新規マイグレーション（028）側で`COMMENT ON COLUMN`を上書きする形で対応する
- **副作用確認済み**: `apps/web/src/`はtag_vocabularyを一切参照せず（grep 0件）、store.pyはservice_role接続のためRLSバイパス、streams.tagsカラムとは独立。フロント・既存データへの影響ゼロ
- **申し送り**: streams.tagsに残る casual_talk/fan_interaction/relationships 等の自由記述タグは、P2のタグクリック絞り込みJOIN時に孤児タグ化しうる。P2着手前に要考慮（P3の欠陥ではない）
- **実装**: borma（ファイル作成）→ prod_guard承認（一幾）→ Supabase MCP経由で適用（`supabase db push`はDBパスワード未設定のため使用不可。CLIパスは今後別途復旧要）
- **適用結果**: `tag_vocabulary`のcasual_talk/fan_interaction/relationshipsが`is_active=false`、active件数25で確認済み。ローカルファイル名`20260704004801_028_...`をリモート適用バージョンに合わせてリネーム済み
- **副次発見**: ローカルの`027_search_logs_insert_policy.sql`がリモート`list_migrations`に存在せず、既存ドリフトあり（本タスク範囲外・別途対応要）

### P4: 承認ゲート＋バックアップ＋クリア（不可逆操作・完了 2026-07-04）

- **スコープ確定（一幾確認済み）**: クリア対象は`chapters`全行＋`streams.highlights`のみ。`tags`・`summary`は対象外（P5の`ai_prompt_ver`基準の冪等再開ロジックで別途上書きされるため事前クリア不要と判断）
- 実行SQLは`10_system/debate/2026-06-22_verify-borma.md`セクション4（borma設計）をベースに、kana実行前レビューで3点修正：
  1. **rollback SQLの欠陥修正（最重要）**: migration016で追加された5列（snapshot_id等）が旧rollback文で復元漏れになりCHECK制約`chapters_snapshot_anchor_consistency`によりスナップ情報が静かに失われる不具合を発見。全列復元版に修正
  2. reset UPDATEに`WHERE highlights IS DISTINCT FROM '[]'::jsonb`を追加（71件のみ対象、305件全件の`updated_at`一斉更新による020 RPCランキング崩れを回避）
  3. `updated_at = now()`の明示指定を削除（`streams_updated_at`トリガーで自動処理されるため冗長と確認）
- **再処理スキップ懸念の解消確認**: `reprocess_videos.py`の対象判定は`ai_prompt_ver != TARGET_PROMPT_VER`のみでchapters有無は見ないことをコード確認済み。chapters削除後も再処理対象から漏れない
- **実行結果**: バックアップ（`chapters_backup_20260704` 277件・`streams_highlights_backup_20260704` 305件）を作成・件数完全一致を確認 → 一幾の明示GO取得 → クリア実行（chapters 277→0件、highlights非空71→0件、streams本体305件は無傷）→ 事後検証で件数確認済み
- prod_guard稼働下（Supabase MCP経由、承認済みの本番DB操作フロー）で実施

### P5: パイロット→コスト試算→全件再処理（進行中・2026-07-04時点で一時中断）

#### 実施済み

1. **TARGET_PROMPT_VERをv4に切替**（memcho実装・一幾承認済み・コミット`dcf84a6`）
2. **5件パイロット**（通常動画3件＋summary_failed 2件）全て実行、エラーなし。タグは全件slug形式で正しく出力。summary_failedの1件（ZwAvEe4xuos）は再試行で正常成功＝「一時的エラー」説を実証。もう1件（xNPTzaNJlZw）はchapters空のため刻印されず保留のまま（既存の安全設計、バグではない）
3. **コスト試算**: Gemini 2.5 Flash公式単価（入力$0.30/1M・出力$2.50/1M）から304件で概算$5〜10程度と算出。一幾の実感（60件で約300円）ともほぼ一致
4. **Gemini APIプラン確認**: Google AI StudioのレートリミットページでTier1（課金設定済み）であることを確認。RPM/TPM/RPDとも過去28日間ピークが上限に対し十分余裕があり、304件の連続実行では上限に達しない見込みと判断
5. **一括モード実行**（`--recent-first`、対象218件）を開始 → **166/218件目でYouTube側IPブロックが多発**（1件あたり数分〜8分の待機が発生、当初想定の45秒/件から大幅悪化）し、一幾の判断で**安全停止**（SIGTERM、prod_guard lock正常cleanup確認済み）
6. **再開可能性を実証確認**: 中断時処理中だった動画（veehz1tofnc）はDB書き込み前で停止しており不整合なし。dry-runで実際にlock取得・残り85件の正確な認識を確認済み

#### 現在のDB状態（2026-07-04時点）

| ai_prompt_ver | status | 件数 |
|---|---|---|
| v4 | public | 128件（処理完了） |
| v3 | public | 73件（一括モード残り、次回自動対象） |
| v3 | summary_failed | 91件（82→91に増加。一括モードでは自動除外されるため個別`--video`対応が必要） |
| null | public | 12件（一括モード残り、次回自動対象） |
| null | transcript_failed | 1件（字幕なし、対象外） |

#### 発見事項・申し送り

- **PERMANENT_FAILURE_STATUSESにsummary_failedが含まれる設計**（`reprocess_videos.py:63`）のため、一括モードでは常にsummary_failedが除外される。summary_failedの実体は「Gemini呼び出し時の一時的エラー（IPブロック・JSONパース失敗等）」であり動画内容起因の恒久的失敗ではないと判明済み（パイロット・本番実行で複数実証）。91件は別途`--video`ループでの個別処理が必要
- **YouTube IPブロック**: 原因は短時間の大量新規アクセスと推測（未確定）。解除にどれくらいかかるか不明。次回再開前に問題が解消しているか要確認
- **新しいエラーパターン発見**: `Gemini 応答のJSONパース失敗`（jYWZyEJY5lI）。頻度・原因は未調査

#### 次回の再開手順

1. YouTube IPブロックの解消状況を確認（数時間〜1日程度で解除される可能性、要実測）
2. `cd packages/pipeline && source .venv/bin/activate && python3 reprocess_videos.py --recent-first` で残り85件（v3 73件+null 12件）を再開
3. 完了後、summary_failed（91件、実行時点の件数から変動の可能性あり）を`--video <id>`で個別ループ処理
4. 全件完了後、P6（事後検証）へ

### P6: 事後検証（fuchikoma）

```sql
-- 語彙外タグが0件になったこと
select count(*) from (
  select unnest(tags) as tag from streams
) t where tag not in (select slug from tag_vocabulary);

-- v4刻印数 = 304（失敗マーカー分は別途内訳提示）
select ai_prompt_ver, count(*) from streams group by 1;
```

- chapters件数・highlights充足率の確認
- `ichiro_status.md` に完了状態が自動反映されていることの確認

## 5. 実行順序

P0実装（debate反映後）→ P1 → P3 → P2（フォールバック込み）→ P4（承認ゲート）→ P5 → P6

## 6. 7月処理済み分の救済（設計判断・debate CRITIQUE待ち)

- snapshot方式chaptersを持つ64件は、チャプター品質がv4と同等（v4はタグ節のみの変更のため）
- タグは25語彙の日本語ラベル→slugの**機械変換SQL**で移行可能（`tag_vocabulary.label` → `slug`）。変換後に `ai_prompt_ver='v4'` を刻印すれば全件再処理から除外され、Gemini再課金を約2割節約
- リスク: 語彙外タグが混じっていた場合の取り扱い（除去して良いか）。P6の検証クエリを64件に先行適用して混入数を確認してから採否を決める

## 7. マガジンとの関係（kiyotaka 4）

- マガジン自動発行（magazine.yml）は7月再取り込みのため**一幾の判断で意図的に停止中**。W25以降の欠番は問題ではない
- 再開は全件再処理完了後、一幾のGOで cron 再有効化。よって処理と発行の衝突は構造的に発生しない

## 8. 削除したタスク

- 会員ブックマークのタグ後方互換対応（kana死角3: bookmarks=1件・タグ文字列非保存のため空論点）

## 9. 未確定事項

- P0の最終仕様（debate CRITIQUE反映後に確定）
- §6 救済案の採否（混入数の実測後）
- Geminiの有料上限の現在値（一幾に確認: 全件処理に足りるか）
