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

### P1: v4プロンプト作成（`packages/pipeline/prompts/v4.txt`）

- 語彙リスト本体（v3.txt 67〜89行相当）を **slug（日本語ラベル）併記** に書き換え。出力はslugのみと明示
- 対象は is_active な25語彙（casual_talk / fan_interaction / relationships は掲載しない）
- 出力例（190行相当）の `"tags": ["音楽制作", "ゲスト", "雑談"]` を `"tags": ["music_production", "guest"]` に修正（「雑談」残存の除去）
- **タグ節以外は変更しない**（チャプター・要約の品質を7月処理分と同等に保ち、§6の救済を成立させるため）

### P2: フロントエンド対応（デプロイ順序制約あり）

- `tag-labels.ts`（slug→日本語表示マップ）に **`map.get(tag) ?? tag` フォールバック必須**
- フォールバックがあれば移行期間中（slug/日本語混在）も表示が壊れないため、フロントは再処理より先にデプロイしてよい。**フォールバックなしの先行デプロイは禁止**
- タグクリック絞り込み（Phase 2 UIタスク）はslug統一完了後に着手

### P3: DB整備（マイグレーション）

- `tag_vocabulary`: casual_talk / fan_interaction / relationships を `is_active=false` に更新
- migration017 の COMMENT に残る架空slug（music_talk / late_night）を実在語彙に修正

### P4: 承認ゲート＋バックアップ＋クリア（不可逆操作）

1. バックアップは**クリア直前の1回のみ**：`chapters` テーブル全行＋`streams` の `highlights`・`tags`・`summary` カラムをバックアップテーブル（`_backup_20260704` サフィックス）へ複製
2. バックアップ件数の検証出力を一幾に提示
3. **一幾の明示GOを得てから**クリア実行（chapters削除・対象カラムのリセット）。GOなしに実行するコマンドを用意しない
4. prod_guard 稼働下で実施（停止系操作の誤爆防止）

### P5: パイロット→コスト試算→全件再処理

1. 5件のテストラン（`--video` 指定）で1件あたりの実コスト・所要時間を実測
2. 304件換算のコスト・時間見積もりを一幾へ提示（概算式: 平均26,139字/件 × 304件 ≒ 入力約1,000万トークン規模。単価は実測で確定）
3. 承認後、`reprocess_videos.py --recent-first` で全件実行。P0機構により中断→再実行は自動で続きから
4. 429/スペンドキャップ到達時は中断し、進捗がichiro_status.mdに自動記録される

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
