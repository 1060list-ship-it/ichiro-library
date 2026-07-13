# 楽曲entity登録機能 設計（初版・kana 1回目クリティカルレビュー反映）

作成: 2026-07-13 / レビュー: kana クリティカルレビュー（2026-07-13, Grok経由）

---

## 1. 目的

- 配信で話題になった特定の楽曲（例:「怪獣」「夜の踊り子」）だけを厳選してentityとして登録できるようにする
- 既存のentitiesナレッジベース（人物・チーム・製品向け）の仕組みをそのまま流用し、配信・マガジン本文からの自動リンクも既存経路で機能させる
- 全曲を機械的に網羅する`songs`マスター（Gemini プロンプト注入用）とは目的が異なるため、両者を汚染しない形で連携させる

## 2. 現状（調査済み）

| 項目 | 内容 |
|---|---|
| `entities`テーブル | 人物・チーム・製品向けナレッジベース。`category`列（family/celebrity/remixer/team/craftsman/product/project）、CHECK制約なし |
| `songs`テーブル | Geminiプロンプト注入用マスターデータのみ（title/album/disc_no/track_no/released_at/notes）。カテゴリ列なし、管理UI皆無、service_role経由のみ操作可 |
| 自動リンク機構 | `packages/pipeline/extract_entities.py`の`find_entity_ids()`。`entities.match_names`（3文字以上のエイリアス）による単純部分文字列一致、category非依存。3経路（`store.py`取り込み時／`weekly_magazine.py`生成時／`extract_entities.py`単体backfill）が同一ロジックを共有 |
| 管理UI | `EntityEditorClient.tsx`にcategory選択select（7種）実装済み。楽曲は選択肢に含まれない |

## 3. レビュー指摘との対応表（kana 1回目）

| 指摘 | 重大度 | 反映先 |
|---|---|---|
| G1: 短題曲名（「怪獣」2文字）が`match_names`3文字以上制約とそのままでは矛盾 | must-fix / 再確認必須 | §4.2（短題は複合エイリアス必須登録） |
| G2: `songs`（Gemini注入用）がentity作成導線から雑なレコードで汚染される | must-fix / 再確認必須 | §4.1（`is_prompt_source`フラグで分離） |
| G3: song+entity 2段階INSERTの原子性が未定義（「ロールバック」が実装未定義） | must-fix / 再確認必須 | §4.3（単一RPC・BEGIN/COMMIT） |
| G4: `category`/`song_id`の不整合をDBレベルで防ぐ制約がない | must-fix / 再確認必須 | §4.1（CHECK制約・ON DELETE RESTRICT） |
| G5: 部分一致マッチの誤爆リスクが未評価 | must-fix / 再確認必須 | §4.2（保存前マッチプレビュー必須） |
| G6: `songs`側の重複排除ルールがない（表記ゆれ・ライブ版等） | must-fix / 再確認必須 | §4.2（新規作成前に同名候補提示必須） |
| G7: 権限モデル未定義（service_role専用テーブルをUI経由で操作） | must-fix / 再確認必須 | §4.3（専用RPC＋admin認証チェック） |
| 9: `entity.name`/`songs.title`等の二重管理の同期ルール未定義 | must-fix / 再確認必須 | §4.4（表示優先はentity.name、初期値コピー） |
| 10: song_id付け替え・再編集フローが未定義 | must-fix / 再確認必須 | §4.2（作成後イミュータブル） |
| 8: 型・Zod・生成型・API経路の更新が設計から欠落 | must-fix / fire-and-forget | §5（実装計画側でチェックリスト化） |
| 11: あいまい検索の仕様（クエリ形状・ソート順）が未定義 | must-fix / fire-and-forget | §4.2（検索API契約は実装計画で確定） |
| 12: slug規約・同一alias衝突時の優先順位 | nice-to-have + must-fix（衝突優先順位） | §4.2 / §4.5 |
| 13: 遡及適用（backfill）の運用手順未文書化 | nice-to-have / fire-and-forget | §4.5 |
| 14: 公開ページの空データ耐性 | nice-to-have / fire-and-forget | §4.4 |
| 15: 1対1前提が将来拡張の壁になる可能性 | nice-to-have / fire-and-forget | §6（今は1:1のまま、参照箇所を集約） |

## 4. 設計詳細

### 4.1 DBスキーマ変更

- `entities.category`に新値`'song'`を追加（運用ルールのみ、CHECK制約自体は値のenum化はしない）
- `entities`に`song_id UUID REFERENCES songs(id) ON DELETE RESTRICT`を追加。UNIQUE制約（1曲1entity）
- CHECK制約を追加：
  ```sql
  ALTER TABLE entities ADD CONSTRAINT entities_song_category_consistency
    CHECK (
      (category = 'song' AND song_id IS NOT NULL)
      OR (category <> 'song' AND song_id IS NULL)
    );
  ```
- `songs.is_prompt_source boolean NOT NULL DEFAULT false`を追加
  - 既存の全songsレコードは移行migrationで`is_prompt_source = true`に一括更新（現行のGemini注入対象を維持するため）
  - entity導線経由で新規作成されたsongは`false`のまま
  - Geminiプロンプト注入クエリ（`packages/pipeline`内の該当箇所）に`WHERE is_prompt_source = true`フィルタを追加
  - 曲を後から注入対象に「昇格」させたい場合は、別途明示的な操作（管理画面の別フラグ切り替え、または手動SQL）で対応。今回のスコープでは昇格UIは作らない

### 4.2 管理画面UI

- `EntityEditorClient.tsx`の`CATEGORIES`配列に`{ value: 'song', label: '楽曲' }`を追加
- `entity/page.tsx`の`CATEGORY_LABELS`にも`song: '楽曲'`を追加
- category=`'song'`選択時のみ表示される追加UI：
  1. **song検索**：タイトルであいまい検索し候補一覧を表示（クエリ契約は実装計画で確定）。**同名候補がある場合は必ず提示し、確認済みでなければ新規作成に進めない**
  2. **新規作成（候補になければ）**：title/album/disc_no/track_no/released_at/notesのフォーム。`is_prompt_source=false`で作成
  3. **match_names必須バリデーション**：3文字以上のエイリアスを最低1件含まないと保存不可。短題曲（例:「怪獣」）は「怪獣（米津玄師）」のような複合エイリアスをUI側で促す
  4. **マッチプレビュー**：保存前に「プレビュー」操作で、直近N件のstream本文に対する`match_names`のヒット件数・該当箇所を表示。誤爆が疑われる場合はエイリアス調整を促す
  5. `song_id`は作成後**イミュータブル**（編集画面での付け替えは不可。付け替えが必要な場合はentityを作り直す運用とする）
- 同一エイリアス文字列が複数entityにヒットする場合の優先順位：既存ロジック通り「エイリアス文字列長の降順」を踏襲し、新規追加時の運用ルールとしてドキュメント化するのみ（コード変更なし）

### 4.3 原子性・権限

- song+entity作成は単一のPostgres RPC関数（例: `create_song_entity(...)`）に集約し、内部で`songs` INSERT→`entities` INSERTを同一トランザクションで実行
- RPCはservice_role権限で定義。呼び出しはServer Action経由のみとし、Server Action入口でadmin認証チェックを必須化
- クライアントから`songs`/`entities`への直接INSERTは禁止のまま維持（既存方針を継続）
- 作成者・作成時刻はRPC内で記録（監査ログ相当）

### 4.4 公開ページでの表示

- `/entity/[slug]`は既存のentity詳細表示（name/description/related_work/external_url等）をそのまま流用
- `song_id`が紐づく場合のみ、`songs`のalbum/track_no/disc_no/released_at情報を追加表示。存在するフィールドのみ表示し、全て空ならメタセクション自体を非表示にする
- 表示優先ルール：見出し・本文は常に`entity.name`/`entity.description`を正とする。`songs.title`はメタ情報としてのみ表示し、両者の食い違いは許容する（同期処理は行わない）
- 新規作成時、UIは`entity.name`の初期値に`songs.title`をコピーする（編集は自由）
- 自動リンク（`linkifyBody`/`linkifyEntities`）は既存経路をそのまま使用、コード変更不要

### 4.5 データフロー

1. 管理画面でentity新規作成→category=`'song'`選択
2. song検索→同名候補があれば確認・選択、なければ新規作成フォーム入力
3. match_names入力（3文字以上のエイリアス必須）
4. マッチプレビューでヒット件数・箇所を確認
5. 保存→RPCで`songs`（`is_prompt_source=false`）と`entities`（`category='song'`, `song_id`）を原子的にINSERT
6. 次回のstream取り込み（`store.py`）／マガジン生成（`weekly_magazine.py`）実行時に自動的に`stream_entities`/`magazine_entities`へリンクが保存される
7. 過去分に遡ってリンクしたい場合は`extract_entities.py`の`backfill()`を手動実行する（運用手順として明記。UIからの一発実行は今回のスコープ外）
8. 公開ページで自動リンク・詳細表示

### 4.6 エラーハンドリング

- `song_id`のUNIQUE制約違反：新規作成前の重複候補提示（§4.2）でUIレベルの大半を防止。RPCレベルでも制約違反時は適切なエラーメッセージを返す
- RPCの原子性により、片方だけ成功する孤立レコードは発生しない
- CHECK制約により、`category`/`song_id`の不整合はDBレベルで拒否される

## 5. スコープ外（今回やらないこと）

- 曲をGemini注入対象へ「昇格」させる専用UI
- backfillのUIからのワンクリック実行（運用手順としてのみ文書化）
- `song_id`の多対多化・付け替えフロー

## 6. 将来の拡張に対する備え

- `song_id`を参照するコードパスは、公開ページ・管理画面・RPC呼び出しの3箇所に集約し、直接SQL/直接クライアントINSERTを散らばらせない。将来1曲に複数entityが必要になった場合の変更コストを局所化する
