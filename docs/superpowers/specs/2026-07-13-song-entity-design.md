# 楽曲entity登録機能 設計（第6版・G2撤回＝is_prompt_sourceフラグ廃止）

作成: 2026-07-13 / レビュー: kana クリティカルレビュー計7回（1〜4回目＋G1マーカー案2回＋G2撤回1回、2026-07-13, Grok経由）

---

## 1. 目的

- 配信で話題になった特定の楽曲（例:「怪獣」「夜の踊り子」）だけを厳選してentityとして登録できるようにする
- 既存のentitiesナレッジベース（人物・チーム・製品向け）の仕組みをそのまま流用し、配信・マガジン本文からの自動リンクも既存経路で機能させる
- `entities`は配信でリンクさせたい曲の厳選登録、`songs`は曲メタ（album/track等）の保持先として参照する、という役割分担にする。現行のGemini曲カタログ注入は静的ファイル（`song_catalog.txt`）経由でDBの`songs`を実行時に読まないため、entity導線での`songs`追加がGemini注入内容に波及する経路は存在しない（静的ファイルの陳腐化・正本問題は本機能のスコープ外、§7参照）

## 2. 現状（調査済み）

| 項目 | 内容 |
|---|---|
| `entities`テーブル | 人物・チーム・製品向けナレッジベース。`category`列（family/celebrity/remixer/team/craftsman/product/project）、CHECK制約なし |
| `songs`テーブル | 曲メタデータ（title/album/disc_no/track_no/released_at/notes）。カテゴリ列なし、管理UI皆無、service_role経由のみ操作可。**Geminiへの曲カタログ注入は実行時にこのテーブルを一切クエリせず、`packages/pipeline/prompts/song_catalog.txt`という静的ファイル（`013_songs.sql`から過去に一度手動生成、自動更新なし）のみを参照する**。データ投入はこれまでmigration（013/014）中心で、本機能によりentity経由のadmin RPC書き込みが新たに加わる |
| 自動リンク機構 | `packages/pipeline/extract_entities.py`の`find_entity_ids()`。`entities.match_names`（3文字以上のエイリアス）による単純部分文字列一致、category非依存。3経路（`store.py`取り込み時／`weekly_magazine.py`生成時／`extract_entities.py`単体backfill）が同一ロジックを共有 |
| 管理UI | `EntityEditorClient.tsx`にcategory選択select（7種）実装済み。楽曲は選択肢に含まれない |
| `songs`実データ | 95件。アルバム単位で構造化（例:「夜の踊り子」は`sakanaction`アルバムtrack4として既存）。`created_by`列なし、`songs_read`ポリシーで全員read可、INSERT/UPDATE/DELETEはservice_roleのみ |
| `entities`実データカラム | `created_at`/`updated_at`はトリガーで自動管理。`created_by`列は存在せず、既存の他category entityでも作成者記録の慣習はない |

**実データからの示唆**: ユーザーが例示した「夜の踊り子」は既にsongsに実在する。つまり「既存song選択→entity作成のみ」という経路（後述§4.3の経路B）は例外ケースではなく、実運用で頻出する主経路と見なすべき。

## 3. レビュー指摘との対応表（kana 1〜4回目＋G1再改訂、確定分のみ）

2回目レビューで「反映済み」判定が出たのは G2・G4・9 のみ。G1・G3・G5・G6・G7・10は「不十分／新たな死角あり」と判定され、第3版〜第4版で仕様を確定。**G1は第4版承認後、一幾から「複合表記は違和感がある」との再指摘を受け、マーカー方式へ再改訂**（第5版）。**さらに実装計画フェーズの調査で、G2が前提としていた「Gemini汚染経路」自体が実在しないと判明し、G2を全面撤回**（本版＝第6版）。

| 指摘 | 重大度 | 最終状態 |
|---|---|---|
| G1: 短題曲名が`match_names`3文字以上制約と矛盾 | must-fix / 再確認必須 | §4.2：**複合表記案（第4版）を破棄し、`＊`マーカー方式へ再改訂**。summary直リンク経路が確認できたため「本文に出現しない文字列＝機能無効化」の懸念を解消。表示時は`＊`→`「」`変換。マガジン非保証は明記（kana 2回の追加レビューで承認、一幾承認 2026-07-13） |
| G2: `songs`がentity導線で汚染される | must-fix / 再確認必須 | §4.1：**`is_prompt_source`フラグ導入を撤回（第6版）**。実装計画フェーズの調査で、Gemini注入は静的ファイル`song_catalog.txt`のみを読みDBの`songs`を一切クエリしないことが判明したため、フラグによる汚染防止自体が不要と判明。静的ファイルの陳腐化問題は別タスク化 |
| G3: 2段階INSERTの原子性・経路契約が未定義 | must-fix / 再確認必須 | **反映済み**。§4.3：RPC関数のシグネチャ・分岐・エラー種別を確定 |
| G4: category/song_id不整合防止 | must-fix / 再確認必須 | **反映済み**（変更なし） |
| G5: 部分一致誤爆リスク未評価 | must-fix / 再確認必須 | **反映済み**。§4.2：対象コーパス・閾値・保存ブロック条件、本番ロジックとの同一性、実行方式を確定 |
| G6: songs重複排除ルールなし | must-fix / 再確認必須 | **反映済み**。§4.2：正規化キー（NFKC＋空白除去＋小文字化）の定義を確定 |
| G7: 権限モデルが作成経路のみ | must-fix / 再確認必須 | **反映済み**。§4.3：CRUD全体の権限表＋`update_song_meta` RPC契約を追加 |
| 9: name/title二重管理の同期ルール | must-fix / 再確認必須 | **反映済み**（変更なし） |
| 10: song_id付け替え・削除後のライフサイクル | must-fix / 再確認必須 | **反映済み**。§4.5：削除時の孤立song方針を確定 |
| 8: 型・Zod・API経路の更新 | must-fix / fire-and-forget | §6（実装計画側でチェックリスト化） |
| 11: あいまい検索のクエリ契約 | must-fix / fire-and-forget | §4.2で正規化キー・候補表示ルールとして確定 |
| 12: slug規約・alias衝突優先順位 | nice-to-have | §4.2（既存ロジック踏襲、変更なし） |
| 13: backfill運用手順 | nice-to-have | §4.4（変更なし） |
| 14: 公開ページ空データ耐性 | nice-to-have | §4.4（変更なし） |
| 15: 1対1前提の将来拡張性 | nice-to-have | §7（変更なし） |

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

- **`songs.is_prompt_source`フラグは導入しない（第6版で撤回）**。実装計画フェーズの調査で、Geminiへの曲カタログ注入（`packages/pipeline/summarize.py`の`_load_song_catalog_text()`）はDBの`songs`テーブルを実行時に一切クエリせず、`packages/pipeline/prompts/song_catalog.txt`という静的ファイル（`013_songs.sql`から過去に一度手動生成されコミットされたスナップショット、自動更新の仕組みなし）を読むだけであることが判明した。コードベース全体で`songs`テーブルへの実クエリ（`.from('songs')`等）は他に存在しない。したがって、entity導線経由でDBの`songs`にレコードを追加しても、Gemini側の注入内容に影響する経路が存在せず、汚染防止フラグは不要
  - **注**: この静的ファイル自体、後から追加された`014_songs_singles.sql`（「怪獣」等のシングル曲）を反映しておらず既に陳腐化している。この問題および「DB/静的ファイルどちらを正本にするか」という根本課題は本機能のスコープ外とし、別タスク（`TASKS.md`「ichiro-library: 実行経路のEvidence Gate導入＋runtime-map.md新設」）として記録済み

### 4.2 管理画面UI

- `EntityEditorClient.tsx`の`CATEGORIES`配列に`{ value: 'song', label: '楽曲' }`を追加
- `entity/page.tsx`の`CATEGORY_LABELS`にも`song: '楽曲'`を追加
- category=`'song'`選択時のみ表示される追加UI：

  1. **song検索**：`songs.title`を対象に以下2種の候補を同時に表示する
     - 完全一致候補：`title`をNFKC正規化＋前後空白除去＋英字小文字化した正規化キーで比較し、完全一致するもの（上位表示）
     - 部分一致候補：正規化キーに対する`ilike '%q%'`（下位表示）
     - **正規化キー完全一致の候補が1件以上ある場合、その一覧を必ず表示し、ユーザーが一覧内の候補を選ぶか、または明示的に「別の曲として新規作成する」ボタンを押さない限り新規作成フォームへ進めない**（ライブ版・カバー版等の意図的な別レコード作成を許容しつつ、無自覚な重複を防ぐ）
     - `songs.title`へのUNIQUE制約は張らない（意図的な重複を許容する設計のため）

  2. **新規作成（候補から選ばない場合）**：title/album/disc_no/track_no/released_at/notesのフォーム。§4.3のRPC経由で作成

  3. **match_names必須バリデーション＋短題マーカー方式（マッチ方針の確定・第5版で改訂）**：
     - `match_names`配列は3文字以上の文字列を最低1件含まないと保存不可（UI・RPC両方でチェック）
     - **短題曲名（「怪獣」等、単体で3文字未満または一般語すぎるもの）は、先頭に全角アスタリスク`＊`を付けた表記（例:`＊怪獣`）をエイリアスとしてmatch_namesに登録する。`＊`は自然な日本語文章には出現しない記号のため、意図的マーカーとして機能する**
     - **運用**：リンクさせたいstreamの`streams.summary`（管理画面から一幾が直接編集可能）に、同一表記（`＊怪獣`）を手動で書き込む。summaryはstream詳細ページで`linkifyBody(stream.summary, entities)`により直接スキャンされるため、この経路は確実に機能する
     - **保証範囲の明記**：
       - ✅ 保証：stream詳細ページ（`/stream/[id]`）でのsummary直リンク
       - ⚠️ 非保証：週刊マガジン。`weekly_magazine.py`はsummaryをGeminiへのプロンプト入力として渡し、Geminiが本文を新規生成するため、`＊`表記がそのまま出力に残る保証はない。マガジン側での改変・言い換えは許容する（一幾承認済み、2026-07-13）
     - **表示変換（見た目の自然さ対応）**：画面表示時、`＊`始まりのマッチ文字列は`＊`を除去し`「」`で囲んで表示する（例：`＊怪獣` → 表示は`「怪獣」`）。リンク自体（`<a href="/entity/slug">`）は維持したまま、表示テキストのみ変換する。`linkifyEntities`内でマッチしたaliasが`＊`始まりの場合にこの変換を適用する
     - **却下した代案の記録**：
       - 複合表記必須案（`怪獣（米津玄師）`）：本文にフル表記が出現する前提が弱く、ヒット率が低いため不採用
       - `「」`単体マーカー案：Gemini生成の初期summaryが自然に`「怪獣」`と書く可能性が高く、意図的マーカーと区別できない誤爆リスクがあるため不採用（kanaレビューで指摘）
     - **match優先規則**：`＊怪獣`と（他entityの）通常表記が同一本文中に併存する場合も、既存の「エイリアス文字列長の降順」ロジックをそのまま適用する（コード変更なし）。`＊`を含む分`＊怪獣`の方が`怪獣`より長いため、仮に将来「怪獣」という別entityが存在しても`＊怪獣`が優先される
     - **運用手順（属人化対策）**：短題曲entityを作成する際、①match_namesに`＊短題名`を登録、②リンクさせたい各streamのsummaryに同一表記`＊短題名`を追記、の2手順をUIのヘルプテキスト・完了チェックリストとして明示する。マーカー未記入は「バグ」ではなく「記入漏れ」として扱う
     - **最小検証（実装完了条件）**：`＊`を含むmatch_namesを持つentityを1件作成し、対応するsummaryに同一表記を書いたstreamで実際にリンクが生成されることを実装完了条件に含める（§6にも記載）

  4. **マッチプレビュー（保存前必須）**：
     - 対象コーパス：全期間の全stream（`transcript`本文・`highlights`・`summary`）およびmagazine本文。直近N件ではなく**全期間**を対象とする（過去に話題になった配信を後から登録する運用が主目的のため、直近絞り込みには意味がない）
     - **マッチロジックは本番の`find_entity_ids()`と完全同一のもの**（`match_names`・3文字以上・部分文字列一致）を使う。プレビュー専用の別ロジックは作らない（プレビューと本番でヒット結果がズレることを防ぐため）
     - 実行方式：Node側でテキストを走査するのではなく、DB側の`ilike`/`position()`ベースのSQL集計で件数・該当箇所を取得しServer Action内で同期実行する。全期間走査でもDBクエリで完結させ、タイムアウトが問題になった場合の非同期化検討は§6の申し送り事項とする
     - 表示内容：ヒット総数、および上位5件のヒット箇所（stream名・配信日・該当抜粋へのリンク）
     - 保存ゲート：
       - ヒット0件 → 保存可能。ただし「ヒットが0件です。今後の配信のために先行登録しますか？」の確認チェックボックスを必須表示
       - ヒット1〜20件 → 追加確認なしでそのまま保存可能
       - ヒット21件以上 → 「一般的な語句の可能性があります。誤リンクがないか確認してください」の警告を表示し、確認チェックボックスを必須表示
     - プレビューを一度も実行せずに保存することは不可（ボタン活性化はプレビュー実行後のみ）

  5. `song_id`は作成後**イミュータブル**（編集画面での付け替えは不可。削除・再作成時の扱いは§4.5参照）

- 同一エイリアス文字列が複数entityにヒットする場合の優先順位：既存ロジック通り「エイリアス文字列長の降順」を踏襲（コード変更なし）

### 4.3 原子性・権限

#### RPC契約（2経路対応）

song作成には「新規song作成」と「既存song選択」の2経路があり（§4.2）、実データ上「夜の踊り子」のような既存song選択が主経路になり得るため、両方を単一RPCの分岐として契約する：

```sql
CREATE FUNCTION create_song_entity(
  p_song_id            UUID,        -- 既存song選択時は指定。新規作成時はNULL
  p_song_title         TEXT,        -- p_song_id が NULL の場合必須
  p_song_album         TEXT,
  p_song_disc_no       INTEGER,
  p_song_track_no      INTEGER,
  p_song_released_at   DATE,
  p_song_notes         TEXT,
  p_entity_slug        TEXT,
  p_entity_name        TEXT,
  p_entity_match_names TEXT[],
  p_entity_description TEXT,
  p_entity_related_work TEXT,
  p_entity_external_url TEXT
) RETURNS UUID
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_song_id   UUID;
  v_entity_id UUID;
BEGIN
  IF p_song_id IS NOT NULL THEN
    -- 経路B: 既存song選択
    SELECT id INTO v_song_id FROM songs WHERE id = p_song_id;
    IF v_song_id IS NULL THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- 経路A: 新規song作成
    IF p_song_title IS NULL THEN
      RAISE EXCEPTION 'song_title_required' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO songs (title, album, disc_no, track_no, released_at, notes)
    VALUES (p_song_title, p_song_album, p_song_disc_no, p_song_track_no, p_song_released_at, p_song_notes)
    RETURNING id INTO v_song_id;
  END IF;

  BEGIN
    INSERT INTO entities (slug, name, match_names, category, description, related_work, external_url, song_id)
    VALUES (p_entity_slug, p_entity_name, p_entity_match_names, 'song', p_entity_description, p_entity_related_work, p_entity_external_url, v_song_id)
    RETURNING id INTO v_entity_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- song_id の UNIQUE 違反(既にentity化済み)か slug の UNIQUE 違反かを制約名で判別
      IF SQLERRM LIKE '%entities_song_id_key%' THEN
        RAISE EXCEPTION 'song_already_has_entity' USING ERRCODE = 'P0001';
      ELSE
        RAISE EXCEPTION 'slug_already_exists' USING ERRCODE = 'P0001';
      END IF;
  END;

  RETURN v_entity_id;
END;
$$;
```

- 例外発生時（経路Aで`songs` INSERT後に`entities` INSERTが失敗した場合を含む）、関数全体が単一トランザクションのため自動的にロールバックされ、孤立`songs`行は発生しない
- エラー種別（`song_not_found` / `song_title_required` / `song_already_has_entity` / `slug_already_exists`）をServer Action側でハンドリングし、対応するUIメッセージを表示する
- 作成者・作成時刻：`entities.created_at`は既存トリガーで自動記録される。`created_by`列は現状`entities`に存在せず、他categoryのentityでも作成者記録の慣習がないため、本機能でも追加しない（RPC呼び出し自体はSupabase側のAPIログで追跡可能な範囲に留める。専用監査テーブルは§7でスコープ外と明記）

#### CRUD権限表

| 操作 | 経路 | 権限 |
|---|---|---|
| song+entity 新規作成 | `create_song_entity` RPC（`SECURITY DEFINER`） | Server Action入口でadmin認証必須。クライアントからの直接呼び出し不可 |
| songのあいまい検索（§4.2） | 通常の`SELECT`（既存`songs_read`ポリシー） | 認証不要（既存ポリシーをそのまま利用、変更なし） |
| song entityの編集（name/description/match_names等） | 既存のentity update Server Action（`EntityEditorClient`経由） | 既存のentity admin権限チェックをそのまま利用（変更なし） |
| 紐づくsongsメタの更新（album等） | 新規：`update_song_meta` RPC（`SECURITY DEFINER`、新設） | Server Action入口でadmin認証必須。「service_role専用」方針は維持しつつ、admin操作専用の狭い経路のみ新設 |
| song entityの削除 | 既存のentity delete Server Action | 既存のentity admin権限チェックをそのまま利用（削除後の`songs`扱いは§4.5） |
| `songs`への直接INSERT/UPDATE/DELETE | なし | クライアントからの直接操作は禁止のまま維持（既存方針を継続） |

#### `update_song_meta` RPC契約

```sql
CREATE FUNCTION update_song_meta(
  p_song_id      UUID,
  p_title        TEXT,
  p_album        TEXT,
  p_disc_no      INTEGER,
  p_track_no     INTEGER,
  p_released_at  DATE,
  p_notes        TEXT
) RETURNS VOID
SECURITY DEFINER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE songs
  SET title = p_title,
      album = p_album,
      disc_no = p_disc_no,
      track_no = p_track_no,
      released_at = p_released_at,
      notes = p_notes
  WHERE id = p_song_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
```

- 更新可能列：`title` / `album` / `disc_no` / `track_no` / `released_at` / `notes`（`songs`テーブルの全列。フラグ列は存在しない、§4.1参照）
- entity紐付きの有無に関わらず`song_id`が存在すれば更新可能（呼び出し口はentity編集画面のみのため、実質的にはentity化済みのsongが対象になる）
- エラー種別：`song_not_found`（該当`song_id`が存在しない場合）
- 呼び出し経路・権限は上表の通り、Server Action入口でのadmin認証必須＋クライアントからの直接呼び出し不可

### 4.4 公開ページでの表示

- `/entity/[slug]`は既存のentity詳細表示（name/description/related_work/external_url等）をそのまま流用
- `song_id`が紐づく場合のみ、`songs`のalbum/track_no/disc_no/released_at情報を追加表示。存在するフィールドのみ表示し、全て空ならメタセクション自体を非表示にする
- 表示優先ルール：見出し・本文は常に`entity.name`/`entity.description`を正とする。`songs.title`はメタ情報としてのみ表示し、両者の食い違いは許容する（同期処理は行わない）
- 新規作成時、UIは`entity.name`の初期値に`songs.title`をコピーする（編集は自由）
- 自動リンクの**マッチ経路**（`linkifyBody`/`linkifyEntities`の走査ロジック）は既存のまま流用する。ただし**G1対応として、`linkifyEntities`内の表示テキスト変換（`＊`始まりaliasを`「」`囲みに変換）のみ追加変更する**（詳細は§4.2・§6）

### 4.5 データフロー・ライフサイクル

#### 新規登録フロー

1. 管理画面でentity新規作成→category=`'song'`選択
2. song検索→正規化キー完全一致候補があれば確認・選択、なければ「別の曲として新規作成」を明示的に選び新規作成フォーム入力
3. match_names入力（3文字以上のエイリアス必須、短題は`＊短題名`のマーカー表記で登録し、該当streamのsummaryにも同一表記を追記）
4. マッチプレビュー実行→ヒット件数・箇所を確認（§4.2のゲート条件を満たさないと保存不可）
5. 保存→`create_song_entity` RPCで経路A/Bいずれかを実行し、`songs`と`entities`を原子的にINSERT
6. 次回のstream取り込み（`store.py`）／マガジン生成（`weekly_magazine.py`）実行時に自動的に`stream_entities`/`magazine_entities`へリンクが保存される
7. 過去分に遡ってリンクしたい場合は`extract_entities.py`の`backfill()`を手動実行する（運用手順として明記。UIからの一発実行は今回のスコープ外）
8. 公開ページで自動リンク・詳細表示

#### 削除・再作成フロー（10番対応）

- `song_id`は作成後イミュータブル。曲の紐付けを変更したい場合は既存entityを削除し、新規entityを作り直す運用とする
- entity削除は既存のentity delete Server Actionをそのまま使用
- **entity削除時、紐づく`songs`行は削除しない**（残す）。理由：`songs`は他entityから再利用され得るデータであり、entity側のライフサイクルに引きずられて削除すると再作成時に情報が失われるため
- 削除後に残る「孤立song」（どのentityからも参照されていない`songs`行）は、次回entity作成時のsong検索（§4.2の正規化キー完全一致候補）で自然に再発見・再利用される。専用の掃除UIやバッチは作らない（棚卸しは運用者の任意判断とし、Runbookにその旨を記載する）
- slug衝突（同名で作り直す等）は既存entity全般と同じ挙動（手動入力必須、衝突時はUIでエラー表示）を踏襲し、本機能固有の対応は追加しない

### 4.6 エラーハンドリング

| ケース | 検知箇所 | 挙動 |
|---|---|---|
| 正規化キー完全一致のsongが既存 | UI（§4.2） | 新規作成前に候補一覧を表示、明示選択なしに新規作成不可 |
| `song_id`のUNIQUE制約違反（既にentity化済み） | RPC（`song_already_has_entity`） | UIで「既にentity化済みです」＋既存entityへのリンクを表示 |
| slugの重複 | RPC（`slug_already_exists`） | 既存entity全般と同じエラー表示（別slugを促す） |
| 指定`song_id`が存在しない | RPC（`song_not_found`） | 想定外エラーとしてUIに表示（通常は検索UI経由なので発生しないはず） |
| 新規作成で`title`未指定 | RPC（`song_title_required`） | UIバリデーションで事前に防止（RPC側は防御的チェック） |
| RPC内の`entities` INSERT失敗全般 | RPC（トランザクション） | `songs` INSERT（経路Aの場合）を含め全体がロールバックされ、孤立レコードは発生しない |
| `category`/`song_id`の不整合 | DB（CHECK制約） | INSERT/UPDATE自体が拒否される（RPC経由以外の書き込み経路が万一あっても防御） |

## 5. スコープ外（今回やらないこと）

- `song_catalog.txt`（Gemini曲カタログ静的ファイル）の再生成・DB参照化UI（G2撤回に伴い、本機能はこのファイルを読み書きしない）
- backfillのUIからのワンクリック実行（運用手順としてのみ文書化）
- `song_id`の多対多化・付け替えフロー
- 専用の作成者・監査ログテーブル

## 6. 実装計画への申し送り事項（8番対応）

以下は本specでは仕様確定済みだが、実装計画（writing-plans）側で具体的な変更ファイル一覧・型定義まで落とし込むべき事項：

- Supabase生成型（`songs`/`entities`テーブル型）の再生成
- entity create/update用Zodスキーマへの`category='song'`・`song_id`バリデーション追加
- Server Actionのpayload定義（§4.3のRPC引数と1対1対応させる）
- `/entity/[slug]`のqueryに`songs` joinを追加
- 公開ページの空状態UI（song_idなし／song側メタが全欄null、の両方でレンダリングが崩れないこと）
- song検索・マッチプレビュー用の新規APIエンドポイント（またはServer Action）の実装
- `create_song_entity` RPC内に`p_entity_match_names`の3文字以上必須バリデーションを実装（§4.2記載の通りUI・RPC両方でチェックする）
- `unique_violation`時の制約判別は`SQLERRM LIKE`ではなく`GET STACKED DIAGNOSTICS ... = CONSTRAINT_NAME`で行う（文字列依存を避ける）
- 全期間マッチプレビューのSQL集計クエリがタイムアウトする規模になった場合の非同期化検討（現状のstream件数では同期SQL集計で十分と判断、将来の増加時に再検討）
- `linkifyEntities`（`apps/web/src/lib/linkify.tsx`）内で、マッチしたaliasが`＊`始まりの場合、表示テキストを`＊`除去＋`「」`囲みに変換する処理を実装（リンク先`href`は変更しない）
- 実装完了条件として、`＊`を含むmatch_namesを持つentityを1件作成し、対応するsummaryに同一表記を書いたstreamで実際にリンクが生成され、表示が`「」`に変換されることを確認する

## 7. 将来の拡張に対する備え

- `song_id`を参照するコードパスは、公開ページ・管理画面・RPC呼び出しの3箇所に集約し、直接SQL/直接クライアントINSERTを散らばらせない。将来1曲に複数entityが必要になった場合の変更コストを局所化する

## 8. 他タスクへの依存契約（G2撤回に伴う申し送り）

本機能は次を前提として設計している：

- Gemini曲カタログ注入経路は静的ファイル（`song_catalog.txt`）のままであり、DBの`songs`テーブルを実行時にクエリしない
- 本機能は`is_prompt_source`相当の印を`songs`に一切付けない（§4.1でG2撤回済み）

将来、`TASKS.md`「ichiro-library: 実行経路のEvidence Gate導入＋runtime-map.md新設」の対応として、Gemini注入をDB参照に切り替える、または静的ファイルをDBから再生成する変更を行う場合は、**entity経由で作成された`songs`行（本機能により新たに生まれる書き込み経路）を注入対象に含めるかどうかを先に設計してから**着手すること。「全件をそのまま注入対象にする」という安易な統合は、本specでG2として撤回した汚染リスクを再発させる。この一文を`TASKS.md`の該当タスクにも転記し、前提条件として残す。
