# 楽曲entity登録機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配信で話題になった特定の楽曲（例:「怪獣」「夜の踊り子」）を、既存の`entities`ナレッジベースの一種（`category='song'`）として登録できるようにする。曲メタは`songs`テーブルと`song_id`で連携し、配信・マガジン本文からの自動リンクも既存の`entities`自動リンク経路をそのまま使う。

**Architecture:** DBスキーマに`entities.song_id`（`songs`へのFK、`entities_song_id_key`という固定名のUNIQUE制約）とCHECK制約を追加し、`create_song_entity`/`update_song_meta`/`preview_song_matches`の3つのPostgres関数（RPC、`SECURITY DEFINER`）で書き込みを一本化する。Next.js側はService Action（`apps/web/src/app/admin/actions.ts`）からこれらのRPCを呼び、既存の`EntityEditorClient.tsx`にcategory `'song'`用の専用パネルを追加する。既存の自動リンク機構（`linkifyEntities`/`find_entity_ids`）はコード変更不要、`linkifyEntities`の表示部分だけ`＊`始まりのマッチを`「」`に変換する処理を1箇所追加する。

**Tech Stack:** Next.js App Router（Server Actions）/ Supabase Postgres（RPC, RLS）/ TypeScript（手書きDatabase型、Zod等のスキーマライブラリは未導入のためこのプロジェクトでは導入しない）/ Playwright（既存の統合テストパターンを踏襲）

## Global Constraints

- 設計根拠は `docs/superpowers/specs/2026-07-13-song-entity-design.md`（第6版、kana計8回のクリティカルレビュー済み）を正本とする。本計画と齟齬があれば設計docを優先し、疑問があれば実装を止めて確認する
- `song_id`のUNIQUE制約名は必ず`entities_song_id_key`に固定する（RPCの`unique_violation`判別がこの名前を契約として参照するため）
- `songs`テーブルへのクライアントからの直接INSERT/UPDATE/DELETEは禁止のまま維持する。書き込みは必ず`create_song_entity`/`update_song_meta`のRPC経由にする
- 短題曲名のマッチは`＊`始まりのマーカー表記（例:`＊怪獣`）のみを仕様とする。「複合表記必須」は第4版で破棄済みの旧案なので実装しない
- `songs.is_prompt_source`のようなフラグは実装しない（G2は第6版で全面撤回。Geminiへの曲カタログ注入は静的ファイル`song_catalog.txt`のみを読み、DBの`songs`を実行時にクエリしないため）
- このプロジェクトにVitest/Jestは導入されていない。データ層（Server Action・RPC）のテストは`apps/web/tests/`配下のPlaywright統合テスト（`invokeServerAction`ヘルパー経由）で書く。UIの見た目・操作感は自動テスト対象外とし、`npm run dev`で実際にブラウザ確認する
- 既存の`entities`/`songs`RLSポリシーは変更しない。新設RPCは`SECURITY DEFINER`で service_role相当の権限を持つため、Server Action側の`requireRole(['admin'])`が唯一の認可ゲートになる

---

## Task 1: DBマイグレーション — entities.song_id + CHECK制約

**Files:**
- Create: `supabase/migrations/20260713120000_030_song_entities_schema.sql`

**Interfaces:**
- Produces: `entities.song_id`列（UUID、NULL許容、`songs.id`へのFK、`ON DELETE RESTRICT`）、UNIQUE制約名`entities_song_id_key`、CHECK制約`entities_song_category_consistency`

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- supabase/migrations/20260713120000_030_song_entities_schema.sql
-- 楽曲entity登録機能: entities と songs を song_id で連携する

ALTER TABLE entities
  ADD COLUMN song_id UUID REFERENCES songs(id) ON DELETE RESTRICT;

ALTER TABLE entities
  ADD CONSTRAINT entities_song_id_key UNIQUE (song_id);

ALTER TABLE entities
  ADD CONSTRAINT entities_song_category_consistency
  CHECK (
    (category = 'song' AND song_id IS NOT NULL)
    OR (category <> 'song' AND song_id IS NULL)
  );

CREATE INDEX idx_entities_song_id ON entities(song_id);
```

- [ ] **Step 2: ローカルSupabaseに適用しlintを通す**

Run: `cd 03_personal_projects/ichiro-library && supabase db reset` （ローカルDBに全migrationを再適用）
Run: `supabase db lint`
Expected: エラー0件。`entities`テーブルに`song_id`列が追加され、`\d entities`相当で`entities_song_id_key`（UNIQUE）と`entities_song_category_consistency`（CHECK）が確認できる

- [ ] **Step 3: 制約が機能することを手動SQLで確認する**

Run（`supabase db psql`またはSQL Editorで）:
```sql
-- CHECK制約違反（categoryがsongなのにsong_idがNULL）が拒否されることを確認
INSERT INTO entities (slug, name, match_names, category, description)
VALUES ('test-song-check', 'テスト', ARRAY['テスト楽曲'], 'song', 'test');
-- Expected: ERROR: new row for relation "entities" violates check constraint "entities_song_category_consistency"
```

- [ ] **Step 4: コミット**

```bash
cd 03_personal_projects/ichiro-library
git add supabase/migrations/20260713120000_030_song_entities_schema.sql
git commit -m "feat(db): entities.song_idとcategory整合CHECK制約を追加"
```

---

## Task 2: DBマイグレーション — create_song_entity RPC

**Files:**
- Create: `supabase/migrations/20260713120100_031_create_song_entity_rpc.sql`

**Interfaces:**
- Consumes: Task 1の`entities.song_id`、`entities_song_id_key`制約名
- Produces: `create_song_entity(...)` RPC関数（引数は下記シグネチャ通り、戻り値は作成された`entities.id`のUUID）。エラー時は`song_not_found` / `song_title_required` / `song_already_has_entity` / `slug_already_exists` / `match_names_too_short`のいずれかを`ERRCODE 'P0001'`でRAISEする

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- supabase/migrations/20260713120100_031_create_song_entity_rpc.sql

CREATE OR REPLACE FUNCTION create_song_entity(
  p_song_id             UUID,
  p_song_title          TEXT,
  p_song_album          TEXT,
  p_song_disc_no        INTEGER,
  p_song_track_no       INTEGER,
  p_song_released_at    DATE,
  p_song_notes          TEXT,
  p_entity_slug         TEXT,
  p_entity_name         TEXT,
  p_entity_match_names  TEXT[],
  p_entity_description  TEXT,
  p_entity_related_work TEXT,
  p_entity_external_url TEXT
) RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_song_id         UUID;
  v_entity_id       UUID;
  v_constraint_name TEXT;
BEGIN
  IF p_entity_match_names IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(p_entity_match_names) alias WHERE length(alias) >= 3) THEN
    RAISE EXCEPTION 'match_names_too_short' USING ERRCODE = 'P0001';
  END IF;

  IF p_song_id IS NOT NULL THEN
    SELECT id INTO v_song_id FROM songs WHERE id = p_song_id;
    IF v_song_id IS NULL THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF p_song_title IS NULL OR length(trim(p_song_title)) = 0 THEN
      RAISE EXCEPTION 'song_title_required' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO songs (title, album, disc_no, track_no, released_at, notes)
    VALUES (trim(p_song_title), p_song_album, p_song_disc_no, p_song_track_no, p_song_released_at, p_song_notes)
    RETURNING id INTO v_song_id;
  END IF;

  BEGIN
    INSERT INTO entities (slug, name, match_names, category, description, related_work, external_url, song_id)
    VALUES (p_entity_slug, p_entity_name, p_entity_match_names, 'song', p_entity_description, p_entity_related_work, p_entity_external_url, v_song_id)
    RETURNING id INTO v_entity_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name = 'entities_song_id_key' THEN
        RAISE EXCEPTION 'song_already_has_entity' USING ERRCODE = 'P0001';
      ELSE
        RAISE EXCEPTION 'slug_already_exists' USING ERRCODE = 'P0001';
      END IF;
  END;

  RETURN v_entity_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_song_entity(
  UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT
) TO service_role;
```

- [ ] **Step 2: ローカルDBに適用**

Run: `supabase db reset && supabase db lint`
Expected: エラー0件

- [ ] **Step 3: 経路A（新規song作成）を手動SQLで確認する**

```sql
SELECT create_song_entity(
  NULL, '手動検証曲', 'テストシングル', 1, 1, '2026-01-01', NULL,
  'test-manual-song', 'テスト楽曲', ARRAY['＊手動検証曲', 'テスト楽曲だよ'],
  'テスト用の説明', NULL, NULL
);
-- Expected: UUID が1件返る

SELECT category, song_id FROM entities WHERE slug = 'test-manual-song';
-- Expected: category='song', song_id が songs.id を指している

-- 後片付け
DELETE FROM entities WHERE slug = 'test-manual-song';
```

- [ ] **Step 4: 経路B（既存song選択）とエラーケースを確認する**

```sql
-- 既存song（例: 「夜の踊り子」）のidを取得
SELECT id FROM songs WHERE title = '夜の踊り子';
-- 上記idを使って経路Bを実行
SELECT create_song_entity(
  '<上記のid>', NULL, NULL, NULL, NULL, NULL, NULL,
  'test-existing-song', '夜の踊り子', ARRAY['夜の踊り子'],
  'テスト用の説明', NULL, NULL
);
-- Expected: UUIDが返る

-- 同じsongで2回目を実行 → song_already_has_entity
SELECT create_song_entity(
  '<同じid>', NULL, NULL, NULL, NULL, NULL, NULL,
  'test-existing-song-2', '夜の踊り子2', ARRAY['夜の踊り子2'],
  'テスト用の説明', NULL, NULL
);
-- Expected: ERROR: song_already_has_entity

-- 3文字未満のmatch_namesのみ → match_names_too_short
SELECT create_song_entity(
  NULL, '短題', NULL, NULL, NULL, NULL, NULL,
  'test-short', '短題', ARRAY['短'],
  'テスト', NULL, NULL
);
-- Expected: ERROR: match_names_too_short

-- 後片付け
DELETE FROM entities WHERE slug = 'test-existing-song';
```

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/20260713120100_031_create_song_entity_rpc.sql
git commit -m "feat(db): create_song_entity RPCを追加（新規/既存song両経路対応）"
```

---

## Task 3: DBマイグレーション — update_song_meta / preview_song_matches RPC

**Files:**
- Create: `supabase/migrations/20260713120200_032_song_meta_and_preview_rpc.sql`

**Interfaces:**
- Produces:
  - `update_song_meta(p_song_id UUID, p_title TEXT, p_album TEXT, p_disc_no INTEGER, p_track_no INTEGER, p_released_at DATE, p_notes TEXT) RETURNS VOID`。存在しない`song_id`なら`song_not_found`をRAISE
  - `preview_song_matches(p_match_names TEXT[]) RETURNS JSONB`。戻り値は`{"total": number, "top": [{"stream_id","video_id","title","stream_date"}, ...最大5件]}`

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- supabase/migrations/20260713120200_032_song_meta_and_preview_rpc.sql

CREATE OR REPLACE FUNCTION update_song_meta(
  p_song_id     UUID,
  p_title       TEXT,
  p_album       TEXT,
  p_disc_no     INTEGER,
  p_track_no    INTEGER,
  p_released_at DATE,
  p_notes       TEXT
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION update_song_meta(UUID, TEXT, TEXT, INTEGER, INTEGER, DATE, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION preview_song_matches(p_match_names TEXT[])
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
STABLE AS $$
DECLARE
  v_total INTEGER;
  v_top   JSONB;
  v_aliases TEXT[];
BEGIN
  SELECT array_agg(alias) INTO v_aliases
  FROM unnest(p_match_names) alias
  WHERE length(alias) >= 3;

  IF v_aliases IS NULL OR array_length(v_aliases, 1) IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'top', '[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_total
  FROM streams s
  WHERE EXISTS (
    SELECT 1 FROM unnest(v_aliases) alias
    WHERE coalesce(s.summary, '') ILIKE '%' || alias || '%'
       OR coalesce(s.transcript, '') ILIKE '%' || alias || '%'
       OR coalesce(s.highlights::text, '') ILIKE '%' || alias || '%'
  );

  SELECT jsonb_agg(jsonb_build_object(
    'stream_id', t.id,
    'video_id', t.video_id,
    'title', t.title,
    'stream_date', t.stream_date
  )) INTO v_top
  FROM (
    SELECT s.id, s.video_id, s.title, s.stream_date
    FROM streams s
    WHERE EXISTS (
      SELECT 1 FROM unnest(v_aliases) alias
      WHERE coalesce(s.summary, '') ILIKE '%' || alias || '%'
         OR coalesce(s.transcript, '') ILIKE '%' || alias || '%'
         OR coalesce(s.highlights::text, '') ILIKE '%' || alias || '%'
    )
    ORDER BY s.stream_date DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object('total', v_total, 'top', coalesce(v_top, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION preview_song_matches(TEXT[]) TO service_role;
```

- [ ] **Step 2: ローカルDBに適用**

Run: `supabase db reset && supabase db lint`
Expected: エラー0件

- [ ] **Step 3: update_song_metaを手動確認**

```sql
SELECT id FROM songs WHERE title = '夜の踊り子';
SELECT update_song_meta('<上記id>', '夜の踊り子', 'sakanaction', 1, 4, '2013-01-01', 'テストメモ');
SELECT title, notes FROM songs WHERE id = '<上記id>';
-- Expected: notes='テストメモ'
-- 後片付け: notesを元に戻す
SELECT update_song_meta('<上記id>', '夜の踊り子', 'sakanaction', 1, 4, '2013-01-01', NULL);

-- 存在しないsong_idでエラーになることを確認
SELECT update_song_meta('00000000-0000-0000-0000-000000000000', 'x', NULL, NULL, NULL, NULL, NULL);
-- Expected: ERROR: song_not_found
```

- [ ] **Step 4: preview_song_matchesを手動確認**

```sql
SELECT preview_song_matches(ARRAY['夜の踊り子']);
-- Expected: {"total": <1件以上>, "top": [...]}

SELECT preview_song_matches(ARRAY['絶対にヒットしないはずの架空曲名xyz123']);
-- Expected: {"total": 0, "top": []}

SELECT preview_song_matches(ARRAY['短']);
-- Expected: {"total": 0, "top": []}  （3文字未満は除外される）
```

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/20260713120200_032_song_meta_and_preview_rpc.sql
git commit -m "feat(db): update_song_meta / preview_song_matches RPCを追加"
```

---

## Task 4: 型定義更新（types.ts）

**Files:**
- Modify: `apps/web/src/lib/types.ts`

**Interfaces:**
- Consumes: Task 1〜3で確定したDBスキーマ・RPCシグネチャ
- Produces: `Song`型、`Entity.song_id`、`Database.Tables.songs`、`Database.Functions.create_song_entity` / `update_song_meta` / `preview_song_matches`、`CreateSongEntityArgs` / `UpdateSongMetaArgs` / `PreviewSongMatchesArgs`/`SongMatchPreviewResult`型

- [ ] **Step 1: Song型とEntity.song_idを追加する**

`apps/web/src/lib/types.ts`の`Entity`型定義（既存58〜71行目）を次のように変更：

```ts
export type Song = {
  id: string
  title: string
  album: string | null
  released_at: string | null
  disc_no: number | null
  track_no: number | null
  notes: string | null
}

export type Entity = {
  id: string
  slug: string
  name: string
  match_names: string[]
  category: 'family' | 'celebrity' | 'remixer' | 'team' | 'craftsman' | 'product' | 'project' | 'song' | string
  role: string | null
  description: string
  related_work: string | null
  external_url: string | null
  sort_order: number | null
  song_id: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: RPC引数・戻り値の型を追加する**

`SearchStreamsArgs`型（既存129〜140行目）の直後に追加：

```ts
export type CreateSongEntityArgs = {
  p_song_id: string | null
  p_song_title: string | null
  p_song_album: string | null
  p_song_disc_no: number | null
  p_song_track_no: number | null
  p_song_released_at: string | null
  p_song_notes: string | null
  p_entity_slug: string
  p_entity_name: string
  p_entity_match_names: string[]
  p_entity_description: string
  p_entity_related_work: string | null
  p_entity_external_url: string | null
}

export type UpdateSongMetaArgs = {
  p_song_id: string
  p_title: string
  p_album: string | null
  p_disc_no: number | null
  p_track_no: number | null
  p_released_at: string | null
  p_notes: string | null
}

export type PreviewSongMatchesArgs = {
  p_match_names: string[]
}

export type SongMatchPreviewResult = {
  total: number
  top: Array<{ stream_id: string; video_id: string; title: string; stream_date: string }>
}
```

- [ ] **Step 3: Database.Tables.songsとFunctionsを追加する**

`Database.Tables`（既存150〜198行目）の`entities`定義の直後に追加：

```ts
      songs: { Row: Song; Insert: Omit<Song, 'id'> & { id?: string }; Update: Partial<Song>; Relationships: [] }
```

`Database.Functions`（既存200〜209行目）を次のように変更：

```ts
    Functions: {
      get_engagement_ranking: {
        Args: EngagementRankingArgs
        Returns: Stream[]
      }
      search_streams: {
        Args: SearchStreamsArgs
        Returns: (Omit<Stream, 'like_count' | 'songs' | 'has_live_singing' | 'has_live_viewing' | 'talk_topics' | 'highlights' | 'status' | 'ai_model' | 'ai_prompt_ver' | 'is_reviewed' | 'created_at' | 'updated_at'> & { total_count: number })[]
      }
      create_song_entity: {
        Args: CreateSongEntityArgs
        Returns: string
      }
      update_song_meta: {
        Args: UpdateSongMetaArgs
        Returns: undefined
      }
      preview_song_matches: {
        Args: PreviewSongMatchesArgs
        Returns: SongMatchPreviewResult
      }
    }
```

- [ ] **Step 2: 型チェックを実行する**

Run: `cd apps/web && npx tsc --noEmit`
Expected: `songs`/`Song`/新規Functions関連のエラーが出ないこと（既存の`Stream.songs`列（`text[]`のCSVフィールド）とテーブル名`songs`が衝突しないか確認する。`Stream`型の`songs: string[] | null`は既存フィールドなのでそのまま残す）

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/lib/types.ts
git commit -m "feat(types): Song型・entities.song_id・song関連RPC型を追加"
```

---

## Task 5: selects.ts更新 + AdminEntity型更新

**Files:**
- Modify: `apps/web/src/lib/selects.ts`
- Modify: `apps/web/src/app/admin/actions.ts:742-786`（`AdminEntity`/`UpsertAdminEntityInput`周辺）

**Interfaces:**
- Consumes: Task 4の`Song`型
- Produces: `AdminEntity.song_id` / `AdminEntity.songs`（`AdminEntitySong | null`）、`ADMIN_ENTITY_SELECT`・`PUBLIC_ENTITY_DETAIL_SELECT`にsong結合列を追加

- [ ] **Step 1: ADMIN_ENTITY_SELECTにsong_idとjoinを追加する**

`apps/web/src/lib/selects.ts`の`ADMIN_ENTITY_SELECT`（既存103〜116行目）を次のように変更：

```ts
export const ADMIN_ENTITY_SELECT = [
  'id',
  'slug',
  'name',
  'match_names',
  'category',
  'role',
  'description',
  'related_work',
  'external_url',
  'sort_order',
  'song_id',
  'created_at',
  'updated_at',
  'songs(id, title, album, disc_no, track_no, released_at, notes)',
].join(', ')
```

- [ ] **Step 2: PUBLIC_ENTITY_DETAIL_SELECTにも追加する**

`apps/web/src/lib/selects.ts`の`PUBLIC_ENTITY_DETAIL_SELECT`（既存75〜84行目）を次のように変更：

```ts
export const PUBLIC_ENTITY_DETAIL_SELECT = [
  'id',
  'slug',
  'name',
  'category',
  'role',
  'description',
  'related_work',
  'external_url',
  'songs(album, disc_no, track_no, released_at)',
].join(', ')
```

- [ ] **Step 3: AdminEntity型・UpsertAdminEntityInput型を更新する**

`apps/web/src/app/admin/actions.ts:742-755`を次のように変更：

```ts
export type AdminEntitySong = {
  id: string
  title: string
  album: string | null
  disc_no: number | null
  track_no: number | null
  released_at: string | null
  notes: string | null
}

export type AdminEntity = {
  id: string
  slug: string
  name: string
  match_names: string[]
  category: string
  role: string | null
  description: string
  related_work: string | null
  external_url: string | null
  sort_order: number | null
  song_id: string | null
  songs: AdminEntitySong | null
  created_at: string
  updated_at: string
}
```

`UpsertAdminEntityInput`型（764〜775行目）はそのまま変更しない（通常カテゴリ用の既存フローを維持し、`category='song'`の作成/更新はTask 8で新設する別のServer Actionを使う）。

- [ ] **Step 4: fetchAdminEntities/fetchAdminEntityの戻り値がjoin結果を含むことを確認する**

Run: `cd apps/web && npx tsc --noEmit`
Expected: エラーなし

一時的な検証スクリプトで実際のSupabase応答形状を確認する（`songs`が単一オブジェクトで返るか配列で返るかはPostgRESTのFK方向で決まるため要実測）：

```bash
cd apps/web
cat > /tmp/verify-song-join.mjs << 'SCRIPT'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data, error } = await supabase.from('entities').select('id, slug, category, song_id, songs(id, title)').eq('category', 'song').limit(1)
console.log(JSON.stringify({ data, error }, null, 2))
SCRIPT
node --env-file=.env.local /tmp/verify-song-join.mjs
rm /tmp/verify-song-join.mjs
```

Expected: `category='song'`のentityがまだ無ければ`data: []`（正常）。Task 8以降で実データができた後に再実行し、`songs`が配列`[{...}]`で返る場合は`AdminEntitySong`型を`AdminEntitySong[] | null`に、Server Action側で`.[0] ?? null`に正規化する対応に切り替える（PostgRESTの挙動としてFK側（`entities.song_id -> songs.id`）からの参照は通常単一オブジェクトで返るが、念のため実測で確定させる）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/lib/selects.ts apps/web/src/app/admin/actions.ts
git commit -m "feat(entity): ADMIN_ENTITY_SELECT/PUBLIC_ENTITY_DETAIL_SELECTにsong結合を追加"
```

---

## Task 6: Server Action — searchSongs（song検索・重複検出）

**Files:**
- Create: `apps/web/src/lib/song-search.ts`
- Modify: `apps/web/src/app/admin/actions.ts`（末尾に追加）
- Test: `apps/web/tests/admin-song-search.spec.ts`

**Interfaces:**
- Consumes: `supabaseAdmin`（`@/lib/supabase-admin`）、`requireRole`（`@/lib/auth`）
- Produces: `normalizeSongTitle(title: string): string`、`searchSongs(query: string): Promise<{ exact: SongSearchResult[]; partial: SongSearchResult[] }>`、`SongSearchResult`型

- [ ] **Step 1: 正規化ユーティリティを作成する**

```ts
// apps/web/src/lib/song-search.ts
export function normalizeSongTitle(title: string): string {
  return title.normalize('NFKC').trim().toLowerCase()
}
```

- [ ] **Step 2: 統合テストを書く（失敗する状態で）**

```ts
// apps/web/tests/admin-song-search.spec.ts
import { expect, test } from '@playwright/test'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

test.describe('searchSongs integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('exact normalized match is returned in exact bucket', async () => {
    const response = await invokeServerAction({
      actionName: 'searchSongs',
      actionArgs: ['夜の踊り子'],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toContain('夜の踊り子')
  })

  test('empty query returns empty result without error', async () => {
    const response = await invokeServerAction({
      actionName: 'searchSongs',
      actionArgs: [''],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
  })
})
```

- [ ] **Step 3: テストを実行し、`searchSongs`未定義で失敗することを確認する**

Run: `cd apps/web && npx playwright test admin-song-search.spec.ts`
Expected: FAIL（`searchSongs` action id を解決できずエラー）

- [ ] **Step 4: searchSongsをadmin/actions.tsに実装する**

`apps/web/src/app/admin/actions.ts`のimport文（既存4〜12行目）に`normalizeSongTitle`を追加：

```ts
import { normalizeSongTitle } from '@/lib/song-search'
```

ファイル末尾に追加：

```ts
export type SongSearchResult = {
  id: string
  title: string
  album: string | null
  released_at: string | null
}

export async function searchSongs(query: string): Promise<{ exact: SongSearchResult[]; partial: SongSearchResult[] }> {
  await requireRole(['admin'])
  const trimmed = query.trim()
  if (!trimmed) return { exact: [], partial: [] }

  const { data, error } = await supabaseAdmin
    .from('songs')
    .select('id, title, album, released_at')
    .ilike('title', `%${trimmed}%`)
    .order('released_at', { ascending: false })
    .limit(20)

  if (error) throw error

  const normalizedQuery = normalizeSongTitle(trimmed)
  const results = (data ?? []) as unknown as SongSearchResult[]
  const exact = results.filter((r) => normalizeSongTitle(r.title) === normalizedQuery)
  const exactIds = new Set(exact.map((r) => r.id))
  const partial = results.filter((r) => !exactIds.has(r.id))

  return { exact, partial }
}
```

- [ ] **Step 5: テストを再実行し成功を確認する**

Run: `cd apps/web && npx playwright test admin-song-search.spec.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/lib/song-search.ts apps/web/src/app/admin/actions.ts apps/web/tests/admin-song-search.spec.ts
git commit -m "feat(entity): searchSongs Server Actionを追加"
```

---

## Task 7: Server Action — previewSongMatches

**Files:**
- Modify: `apps/web/src/app/admin/actions.ts`（末尾に追加）
- Test: `apps/web/tests/admin-song-preview.spec.ts`

**Interfaces:**
- Consumes: Task 3の`preview_song_matches` RPC、Task 4の`SongMatchPreviewResult`型
- Produces: `previewSongMatches(matchNames: string[]): Promise<SongMatchPreviewResult>`

- [ ] **Step 1: 統合テストを書く**

```ts
// apps/web/tests/admin-song-preview.spec.ts
import { expect, test } from '@playwright/test'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

test.describe('previewSongMatches integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())

  test('short aliases under 3 chars are excluded and return zero hits', async () => {
    const response = await invokeServerAction({
      actionName: 'previewSongMatches',
      actionArgs: [['短']],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toContain('"total":0')
  })

  test('nonexistent phrase returns zero hits without error', async () => {
    const response = await invokeServerAction({
      actionName: 'previewSongMatches',
      actionArgs: [['絶対にヒットしないはずの架空曲名xyz123']],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })

    expect(response.status).toBe(200)
    expect(response.errorMessage).toBeNull()
    expect(response.text).toContain('"total":0')
  })
})
```

- [ ] **Step 2: テスト失敗を確認する**

Run: `cd apps/web && npx playwright test admin-song-preview.spec.ts`
Expected: FAIL（`previewSongMatches`未定義）

- [ ] **Step 3: previewSongMatchesを実装する**

`apps/web/src/app/admin/actions.ts`末尾に追加：

```ts
export async function previewSongMatches(matchNames: string[]): Promise<SongMatchPreviewResult> {
  await requireRole(['admin'])
  const { data, error } = await supabaseAdmin.rpc('preview_song_matches', { p_match_names: matchNames })
  if (error) throw error
  return data as unknown as SongMatchPreviewResult
}
```

`import type { Database, Highlight, Stream } from '@/lib/types'`（既存12行目）を次のように変更：

```ts
import type { Database, Highlight, Stream, SongMatchPreviewResult } from '@/lib/types'
```

- [ ] **Step 4: テストを再実行し成功を確認する**

Run: `cd apps/web && npx playwright test admin-song-preview.spec.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/app/admin/actions.ts apps/web/tests/admin-song-preview.spec.ts
git commit -m "feat(entity): previewSongMatches Server Actionを追加"
```

---

## Task 8: Server Action — createSongEntity / updateSongMetaAction

**Files:**
- Modify: `apps/web/src/app/admin/actions.ts`（末尾に追加）
- Test: `apps/web/tests/admin-song-entity-crud.spec.ts`

**Interfaces:**
- Consumes: Task 2・3のRPC、Task 4の`CreateSongEntityArgs`/`UpdateSongMetaArgs`型
- Produces: `createSongEntity(input: CreateSongEntityInput): Promise<{ id: string }>`、`updateSongMetaAction(input: UpdateSongMetaInput): Promise<void>`、`CreateSongEntityInput`/`UpdateSongMetaInput`型

- [ ] **Step 1: 統合テストを書く（fixture作成〜削除込み）**

```ts
// apps/web/tests/admin-song-entity-crud.spec.ts
import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'
import { invokeServerAction } from './helpers/server-actions'

const testEnv = getTestEnv()

function uniqueSlug() {
  return `test-song-entity-${Date.now()}${Math.random().toString(36).slice(2, 6)}`
}

async function cleanupBySlug(slug: string) {
  const service = getSupabaseServiceRoleClient()
  const { data } = await service.from('entities').select('id, song_id').eq('slug', slug).maybeSingle()
  if (data) {
    await service.from('entities').delete().eq('id', data.id)
    if (data.song_id) {
      await service.from('songs').delete().eq('id', data.song_id)
    }
  }
}

test.describe('createSongEntity / updateSongMetaAction integration', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('creates a new song and entity via route A', async () => {
    const slug = uniqueSlug()
    try {
      const response = await invokeServerAction({
        actionName: 'createSongEntity',
        actionArgs: [{
          songId: null,
          songTitle: 'E2Eテスト楽曲',
          songAlbum: 'テストシングル',
          songDiscNo: '1',
          songTrackNo: '1',
          songReleasedAt: '2026-01-01',
          songNotes: '',
          entitySlug: slug,
          entityName: 'E2Eテスト楽曲',
          entityMatchNames: ['＊E2Eテスト楽曲'],
          entityDescription: 'テスト説明',
          entityRelatedWork: '',
          entityExternalUrl: '',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: '/admin/entity/new',
        role: 'admin',
      })

      expect(response.status).toBe(200)
      expect(response.errorMessage).toBeNull()

      const service = getSupabaseServiceRoleClient()
      const { data } = await service.from('entities').select('category, song_id').eq('slug', slug).single()
      expect(data?.category).toBe('song')
      expect(data?.song_id).not.toBeNull()
    } finally {
      await cleanupBySlug(slug)
    }
  })

  test('match_names shorter than 3 chars is rejected', async () => {
    const slug = uniqueSlug()
    try {
      const response = await invokeServerAction({
        actionName: 'createSongEntity',
        actionArgs: [{
          songId: null,
          songTitle: '短題テスト',
          songAlbum: '',
          songDiscNo: '',
          songTrackNo: '',
          songReleasedAt: '',
          songNotes: '',
          entitySlug: slug,
          entityName: '短題テスト',
          entityMatchNames: ['短'],
          entityDescription: '',
          entityRelatedWork: '',
          entityExternalUrl: '',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: '/admin/entity/new',
        role: 'admin',
      })

      expect(response.errorMessage).not.toBeNull()
    } finally {
      await cleanupBySlug(slug)
    }
  })

  test('updateSongMetaAction updates songs row', async () => {
    const slug = uniqueSlug()
    const createResponse = await invokeServerAction({
      actionName: 'createSongEntity',
      actionArgs: [{
        songId: null,
        songTitle: 'メタ更新テスト曲',
        songAlbum: '旧アルバム',
        songDiscNo: '1',
        songTrackNo: '1',
        songReleasedAt: '2026-01-01',
        songNotes: '',
        entitySlug: slug,
        entityName: 'メタ更新テスト曲',
        entityMatchNames: ['＊メタ更新テスト曲'],
        entityDescription: '',
        entityRelatedWork: '',
        entityExternalUrl: '',
      }],
      manifestRoute: 'admin/entity/[id]',
      pagePath: '/admin/entity/new',
      role: 'admin',
    })
    expect(createResponse.errorMessage).toBeNull()

    try {
      const service = getSupabaseServiceRoleClient()
      const { data: entity } = await service.from('entities').select('song_id').eq('slug', slug).single()
      const songId = entity?.song_id as string

      const updateResponse = await invokeServerAction({
        actionName: 'updateSongMetaAction',
        actionArgs: [{
          songId,
          title: 'メタ更新テスト曲',
          album: '新アルバム',
          discNo: '1',
          trackNo: '2',
          releasedAt: '2026-02-01',
          notes: '更新済み',
        }],
        manifestRoute: 'admin/entity/[id]',
        pagePath: `/admin/entity/new`,
        role: 'admin',
      })

      expect(updateResponse.status).toBe(200)
      expect(updateResponse.errorMessage).toBeNull()

      const { data: song } = await service.from('songs').select('album, notes').eq('id', songId).single()
      expect(song?.album).toBe('新アルバム')
      expect(song?.notes).toBe('更新済み')
    } finally {
      await cleanupBySlug(slug)
    }
  })
})
```

- [ ] **Step 2: テスト失敗を確認する**

Run: `cd apps/web && npx playwright test admin-song-entity-crud.spec.ts`
Expected: FAIL（`createSongEntity`/`updateSongMetaAction`未定義）

- [ ] **Step 3: createSongEntity / updateSongMetaActionを実装する**

`apps/web/src/app/admin/actions.ts`末尾に追加：

```ts
export type CreateSongEntityInput = {
  songId: string | null
  songTitle: string
  songAlbum: string
  songDiscNo: string
  songTrackNo: string
  songReleasedAt: string
  songNotes: string
  entitySlug: string
  entityName: string
  entityMatchNames: string[]
  entityDescription: string
  entityRelatedWork: string
  entityExternalUrl: string
}

export type UpdateSongMetaInput = {
  songId: string
  title: string
  album: string
  discNo: string
  trackNo: string
  releasedAt: string
  notes: string
}

function mapSongRpcErrorMessage(message: string): string {
  switch (message) {
    case 'song_not_found':
      return '指定された楽曲が見つかりませんでした。'
    case 'song_title_required':
      return '新規作成時は楽曲タイトルが必須です。'
    case 'song_already_has_entity':
      return 'この楽曲は既にエンティティ化されています。'
    case 'slug_already_exists':
      return 'このスラッグは既に使用されています。'
    case 'match_names_too_short':
      return '3文字以上の別名キーワードを少なくとも1件登録してください。'
    default:
      return '保存に失敗しました。'
  }
}

export async function createSongEntity(input: CreateSongEntityInput): Promise<{ id: string }> {
  await requireRole(['admin'])
  const { data, error } = await supabaseAdmin.rpc('create_song_entity', {
    p_song_id: input.songId,
    p_song_title: input.songId ? null : input.songTitle.trim(),
    p_song_album: input.songAlbum.trim() || null,
    p_song_disc_no: input.songDiscNo !== '' ? Number(input.songDiscNo) : null,
    p_song_track_no: input.songTrackNo !== '' ? Number(input.songTrackNo) : null,
    p_song_released_at: input.songReleasedAt || null,
    p_song_notes: input.songNotes.trim() || null,
    p_entity_slug: input.entitySlug.trim(),
    p_entity_name: input.entityName.trim(),
    p_entity_match_names: input.entityMatchNames,
    p_entity_description: input.entityDescription.trim(),
    p_entity_related_work: input.entityRelatedWork.trim() || null,
    p_entity_external_url: input.entityExternalUrl.trim() || null,
  })

  if (error) {
    throw new Error(mapSongRpcErrorMessage(error.message))
  }

  revalidatePath('/admin/entity')
  revalidatePath('/entity')
  return { id: data as unknown as string }
}

export async function updateSongMetaAction(input: UpdateSongMetaInput): Promise<void> {
  await requireRole(['admin'])
  const { error } = await supabaseAdmin.rpc('update_song_meta', {
    p_song_id: input.songId,
    p_title: input.title.trim(),
    p_album: input.album.trim() || null,
    p_disc_no: input.discNo !== '' ? Number(input.discNo) : null,
    p_track_no: input.trackNo !== '' ? Number(input.trackNo) : null,
    p_released_at: input.releasedAt || null,
    p_notes: input.notes.trim() || null,
  })

  if (error) {
    throw new Error(mapSongRpcErrorMessage(error.message))
  }

  revalidatePath('/admin/entity')
  revalidatePath('/entity')
}
```

- [ ] **Step 4: テストを再実行し成功を確認する**

Run: `cd apps/web && npx playwright test admin-song-entity-crud.spec.ts`
Expected: PASS（3件とも）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/app/admin/actions.ts apps/web/tests/admin-song-entity-crud.spec.ts
git commit -m "feat(entity): createSongEntity/updateSongMetaAction Server Actionを追加"
```

---

## Task 9: linkify.tsx — ＊マーカーの表示変換

**Files:**
- Modify: `apps/web/src/lib/linkify.tsx:39-52`（`linkifyEntities`関数内）
- Test: `apps/web/tests/linkify-marker.spec.ts`

**Interfaces:**
- Consumes: なし（既存の`linkifyEntities`のロジックのみ変更）
- Produces: `＊`始まりのマッチ文字列を`「」`表示に変換する挙動（`href`は変更しない）

このプロジェクトに単体テストランナーが無いため、`linkifyEntities`はReactコンポーネントの純粋な変換ロジックを持つ関数として、Playwrightでレンダリング結果をブラウザ越しに検証する統合テストで確認する。既存の`stream/[id]/page.tsx`が`summary`をレンダリングする経路をそのまま使う。

- [ ] **Step 1: 変換前のstream fixtureで表示を確認するテストを書く**

```ts
// apps/web/tests/linkify-marker.spec.ts
import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'

const testEnv = getTestEnv()

test.describe('linkifyEntities marker display', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('＊marker in summary renders as 「」without the asterisk, still linked', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()

    const { data: entity, error: entityError } = await service
      .from('entities')
      .insert({
        slug: `linkify-marker-test-${Date.now()}`,
        name: 'マーカー表示テスト曲',
        match_names: ['＊マーカー表示テスト曲'],
        category: 'song',
        description: 'テスト',
      })
      .select('id, slug')
      .single()
    expect(entityError).toBeNull()

    const videoId = `linkifymarker${Date.now()}`
    const { data: stream, error: streamError } = await service
      .from('streams')
      .insert({
        video_id: videoId,
        title: 'linkify marker fixture',
        stream_date: '2026-01-01',
        summary: '今日は＊マーカー表示テスト曲を歌った。',
        status: 'public',
      })
      .select('id')
      .single()
    expect(streamError).toBeNull()

    try {
      await page.goto(`/stream/${videoId}`)
      const link = page.locator(`a[href="/entity/${entity!.slug}"]`)
      await expect(link).toHaveText('「マーカー表示テスト曲」')
    } finally {
      await service.from('streams').delete().eq('id', stream!.id)
      await service.from('entities').delete().eq('id', entity!.id)
    }
  })
})
```

- [ ] **Step 2: テスト失敗を確認する**

Run: `cd apps/web && npx playwright test linkify-marker.spec.ts`
Expected: FAIL（リンクテキストが`＊マーカー表示テスト曲`のまま、期待値`「マーカー表示テスト曲」`と不一致）

- [ ] **Step 3: linkifyEntitiesに表示変換を実装する**

`apps/web/src/lib/linkify.tsx`の`linkifyEntities`関数（既存39〜52行目）を次のように変更：

```tsx
export function linkifyEntities(text: string | null | undefined, entities: LinkableEntity[]): ReactNode {
  if (!text) return text ?? ''

  const aliases = entities
    .flatMap((entity) =>
      (entity.match_names ?? [])
        .filter((name) => name.length >= 3)
        .map((name) => ({ name, entity }))
    )
    .sort((a, b) => b.name.length - a.name.length)

  if (aliases.length === 0) return text

  const aliasToEntity = new Map<string, LinkableEntity>()
  for (const alias of aliases) {
    if (!aliasToEntity.has(alias.name)) aliasToEntity.set(alias.name, alias.entity)
  }

  const pattern = new RegExp(`(${aliases.map((alias) => escapeRegExp(alias.name)).join('|')})`, 'g')
  const parts = text.split(pattern)
  const hasMatch = parts.some((part) => aliasToEntity.has(part))

  if (!hasMatch) return text

  return parts.map((part, index) => {
    const entity = aliasToEntity.get(part)
    if (!entity) return part

    const displayText = part.startsWith('＊') ? `「${part.slice(1)}」` : part

    return (
      <Link
        key={`${entity.slug}-${index}`}
        href={`/entity/${entity.slug}`}
        className="text-indigo-300 underline decoration-indigo-500/40 underline-offset-4 hover:text-indigo-200"
      >
        {displayText}
      </Link>
    )
  })
}
```

- [ ] **Step 4: テストを再実行し成功を確認する**

Run: `cd apps/web && npx playwright test linkify-marker.spec.ts`
Expected: PASS

- [ ] **Step 5: 既存のlinkify利用箇所（マーカーなし）が壊れていないことを確認する**

Run: `cd apps/web && npx playwright test admin-update-stream.spec.ts`
Expected: PASS（既存テストに影響がないこと）

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/lib/linkify.tsx apps/web/tests/linkify-marker.spec.ts
git commit -m "feat(linkify): ＊マーカーを「」表示に変換する処理を追加"
```

---

## Task 10: UI — SongPickerPanel（新規作成用）

**Files:**
- Create: `apps/web/src/app/admin/entity/[id]/SongPickerPanel.tsx`

**Interfaces:**
- Consumes: `searchSongs`/`previewSongMatches`（Task 6・7、`../../actions`からimport）、`SongSearchResult`/`SongMatchPreviewResult`型
- Produces: `SongPickerPanel`コンポーネント。Props: `songId: string | null`、`onSongIdChange: (id: string | null) => void`、`newSongFields`、`onNewSongFieldsChange`、`matchNames: string[]`、`previewConfirmed: boolean`、`onPreviewConfirmedChange: (v: boolean) => void`

- [ ] **Step 1: コンポーネントファイルを作成する**

```tsx
// apps/web/src/app/admin/entity/[id]/SongPickerPanel.tsx
'use client'

import { useState } from 'react'
import { searchSongs, previewSongMatches } from '../../actions'
import type { SongSearchResult } from '../../actions'
import type { SongMatchPreviewResult } from '@/lib/types'

export type NewSongFields = {
  title: string
  album: string
  discNo: string
  trackNo: string
  releasedAt: string
  notes: string
}

type Props = {
  songId: string | null
  onSongIdChange: (id: string | null) => void
  newSongFields: NewSongFields
  onNewSongFieldsChange: (fields: NewSongFields) => void
  matchNames: string[]
  previewConfirmed: boolean
  onPreviewConfirmedChange: (confirmed: boolean) => void
}

const fieldClass = 'w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition focus:border-gray-600'

export default function SongPickerPanel({
  songId,
  onSongIdChange,
  newSongFields,
  onNewSongFieldsChange,
  matchNames,
  previewConfirmed,
  onPreviewConfirmedChange,
}: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [exactMatches, setExactMatches] = useState<SongSearchResult[]>([])
  const [partialMatches, setPartialMatches] = useState<SongSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [preview, setPreview] = useState<SongMatchPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const validAliasCount = matchNames.filter((n) => n.trim().length >= 3).length

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    try {
      const result = await searchSongs(query.trim())
      setExactMatches(result.exact)
      setPartialMatches(result.partial)
      setSearched(true)
      setCreatingNew(result.exact.length === 0)
    } finally {
      setSearching(false)
    }
  }

  async function handlePreview() {
    setPreviewing(true)
    setPreviewError('')
    try {
      const result = await previewSongMatches(matchNames)
      setPreview(result)
      onPreviewConfirmedChange(false)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'プレビューに失敗しました。')
    } finally {
      setPreviewing(false)
    }
  }

  const selectedSong = [...exactMatches, ...partialMatches].find((s) => s.id === songId)
  const needsConfirmation = preview !== null && (preview.total === 0 || preview.total > 20)

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold">紐づける楽曲</h2>
        <p className="mt-1 text-xs text-gray-500">既存の楽曲を検索するか、見つからなければ新規作成してください。</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        {songId && selectedSong ? (
          <div className="flex items-center justify-between rounded-lg border border-indigo-800 bg-indigo-950/30 px-3 py-2">
            <div>
              <p className="text-sm text-white">{selectedSong.title}</p>
              <p className="text-xs text-gray-500">{selectedSong.album ?? '(アルバム不明)'}</p>
            </div>
            <button type="button" onClick={() => onSongIdChange(null)} className="text-xs text-gray-400 hover:text-white transition-colors">
              選び直す
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                className={fieldClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch() } }}
                placeholder="楽曲タイトルで検索"
              />
              <button
                type="button"
                onClick={() => void handleSearch()}
                disabled={searching || !query.trim()}
                className="flex-shrink-0 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 disabled:opacity-40"
              >
                {searching ? '検索中…' : '検索'}
              </button>
            </div>

            {searched && exactMatches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">完全一致候補（選択するか、下から別の曲として新規作成してください）</p>
                {exactMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSongIdChange(s.id)}
                    className="w-full text-left rounded-lg border border-gray-800 px-3 py-2 text-sm text-gray-200 hover:border-gray-600"
                  >
                    {s.title}（{s.album ?? '不明'}）
                  </button>
                ))}
              </div>
            )}

            {searched && partialMatches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">部分一致候補</p>
                {partialMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSongIdChange(s.id)}
                    className="w-full text-left rounded-lg border border-gray-800 px-3 py-2 text-sm text-gray-200 hover:border-gray-600"
                  >
                    {s.title}（{s.album ?? '不明'}）
                  </button>
                ))}
              </div>
            )}

            {searched && exactMatches.length > 0 && !creatingNew && (
              <button
                type="button"
                onClick={() => setCreatingNew(true)}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                別の曲として新規作成する
              </button>
            )}

            {(!searched || creatingNew) && (
              <div className="space-y-3 border-t border-gray-800 pt-3">
                <p className="text-xs text-gray-500">新規楽曲として登録</p>
                <input
                  className={fieldClass}
                  value={newSongFields.title}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, title: e.target.value })}
                  placeholder="曲名 *"
                />
                <input
                  className={fieldClass}
                  value={newSongFields.album}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, album: e.target.value })}
                  placeholder="アルバム/シングル名"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    className={fieldClass}
                    value={newSongFields.discNo}
                    onChange={(e) => onNewSongFieldsChange({ ...newSongFields, discNo: e.target.value })}
                    placeholder="disc番号"
                  />
                  <input
                    type="number"
                    className={fieldClass}
                    value={newSongFields.trackNo}
                    onChange={(e) => onNewSongFieldsChange({ ...newSongFields, trackNo: e.target.value })}
                    placeholder="track番号"
                  />
                </div>
                <input
                  type="date"
                  className={fieldClass}
                  value={newSongFields.releasedAt}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, releasedAt: e.target.value })}
                />
                <textarea
                  className={`${fieldClass} min-h-[60px] resize-y`}
                  value={newSongFields.notes}
                  onChange={(e) => onNewSongFieldsChange({ ...newSongFields, notes: e.target.value })}
                  placeholder="メモ"
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        <h3 className="text-sm font-semibold">マッチプレビュー（保存前必須）</h3>
        <p className="text-xs text-gray-500">別名キーワードが配信本文にどれだけヒットするか、保存前に必ず確認してください。</p>
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={previewing || validAliasCount === 0}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 disabled:opacity-40"
        >
          {previewing ? '確認中…' : 'マッチをプレビュー'}
        </button>
        {previewError && <p className="text-xs text-red-400">{previewError}</p>}
        {preview && (
          <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-950 p-3">
            <p className="text-sm text-white">ヒット件数: {preview.total}件</p>
            {preview.top.length > 0 && (
              <ul className="space-y-1">
                {preview.top.map((s) => (
                  <li key={s.stream_id} className="text-xs text-gray-400">
                    {s.title}（{s.stream_date}）
                  </li>
                ))}
              </ul>
            )}
            {needsConfirmation && (
              <label className="flex items-center gap-2 text-xs text-amber-400">
                <input
                  type="checkbox"
                  checked={previewConfirmed}
                  onChange={(e) => onPreviewConfirmedChange(e.target.checked)}
                />
                {preview.total === 0
                  ? 'ヒットが0件ですが、今後の配信のために先行登録します'
                  : '一般的な語句の可能性があります。誤リンクがないか確認しました'}
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 型チェックを実行する**

Run: `cd apps/web && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add apps/web/src/app/admin/entity/[id]/SongPickerPanel.tsx
git commit -m "feat(entity): SongPickerPanelコンポーネントを追加"
```

---

## Task 11: UI — EntityEditorClient.tsx統合 + entity/page.tsx CATEGORY_LABELS

**Files:**
- Modify: `apps/web/src/app/admin/entity/[id]/EntityEditorClient.tsx`
- Modify: `apps/web/src/app/admin/entity/page.tsx:7-15`

**Interfaces:**
- Consumes: `SongPickerPanel`（Task 10）、`createSongEntity`/`updateSongMetaAction`（Task 8）
- Produces: category=`'song'`選択時にSongPickerPanelを表示し、保存時に適切なServer Actionを呼ぶ`EntityEditorClient`

- [ ] **Step 1: CATEGORIESに'song'を追加する**

`apps/web/src/app/admin/entity/[id]/EntityEditorClient.tsx`の`CATEGORIES`配列（既存10〜18行目）を次のように変更：

```tsx
const CATEGORIES = [
  { value: 'family',    label: '家族・地元' },
  { value: 'celebrity', label: '交友・影響元' },
  { value: 'remixer',   label: 'リミキサー' },
  { value: 'team',      label: 'チーム' },
  { value: 'craftsman', label: '職人' },
  { value: 'product',   label: 'コラボ製品' },
  { value: 'project',   label: 'プロジェクト' },
  { value: 'song',      label: '楽曲' },
]
```

**重要な注意（DB CHECK制約との整合）**: `entities_song_category_consistency`制約により、`category='song'`なのに`song_id`がNULLの行はDB側で拒否される。しかし既存の非song entityを編集中に、UIでcategoryを「楽曲」に切り替えて保存すると、`song_id`を持たないまま`upsertAdminEntity`（通常の更新経路）で保存されようとし、DBエラーになってしまう。これを防ぐため、既存entity編集時は現在のcategoryが`'song'`でない限り「楽曲」を選択肢から除外する。Step4でこのフィルタをselect要素に適用する。

- [ ] **Step 2: song関連stateとインポートを追加する**

ファイル冒頭のimport文（既存1〜8行目）を次のように変更：

```tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useRef } from 'react'
import type { AdminEntity, AdminEntityStream } from '../../actions'
import { deleteAdminEntity, upsertAdminEntity, createSongEntity, updateSongMetaAction } from '../../actions'
import { suggestEntityFields, type SuggestEntityResult } from '@/app/admin/actions'
import SongPickerPanel, { type NewSongFields } from './SongPickerPanel'
```

`EntityEditorClient`関数内、既存のstate群（36〜49行目）の直後に追加：

```tsx
  const [songId, setSongId] = useState<string | null>(entity?.song_id ?? null)
  const [newSongFields, setNewSongFields] = useState<NewSongFields>({
    title: '',
    album: '',
    discNo: '',
    trackNo: '',
    releasedAt: '',
    notes: '',
  })
  const [songMeta, setSongMeta] = useState({
    title: entity?.songs?.title ?? '',
    album: entity?.songs?.album ?? '',
    discNo: entity?.songs?.disc_no?.toString() ?? '',
    trackNo: entity?.songs?.track_no?.toString() ?? '',
    releasedAt: entity?.songs?.released_at ?? '',
    notes: entity?.songs?.notes ?? '',
  })
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
```

- [ ] **Step 3: handleSaveをcategory分岐に対応させる**

既存の`handleSave`関数（84〜102行目）を次のように置き換える：

```tsx
  async function handleSave() {
    if (!name.trim() || !slug.trim()) {
      setError('名前とスラッグは必須です。')
      return
    }

    if (category === 'song') {
      const validAliasCount = matchNames.filter((n) => n.trim().length >= 3).length
      if (validAliasCount === 0) {
        setError('3文字以上の別名キーワードを少なくとも1件登録してください。')
        return
      }
      if (!songId && !newSongFields.title.trim()) {
        setError('楽曲を検索して選択するか、新規作成のタイトルを入力してください。')
        return
      }
    }

    setSaving(true)
    setError('')
    try {
      if (category === 'song' && !entity) {
        await createSongEntity({
          songId,
          songTitle: newSongFields.title,
          songAlbum: newSongFields.album,
          songDiscNo: newSongFields.discNo,
          songTrackNo: newSongFields.trackNo,
          songReleasedAt: newSongFields.releasedAt,
          songNotes: newSongFields.notes,
          entitySlug: slug,
          entityName: name,
          entityMatchNames: matchNames,
          entityDescription: description,
          entityRelatedWork: relatedWork,
          entityExternalUrl: externalUrl,
        })
      } else if (category === 'song' && entity) {
        await upsertAdminEntity({
          id: entity.id,
          name, slug, category, role, description,
          matchNames, relatedWork, externalUrl, sortOrder,
        })
        if (entity.song_id) {
          await updateSongMetaAction({
            songId: entity.song_id,
            title: songMeta.title,
            album: songMeta.album,
            discNo: songMeta.discNo,
            trackNo: songMeta.trackNo,
            releasedAt: songMeta.releasedAt,
            notes: songMeta.notes,
          })
        }
      } else {
        await upsertAdminEntity({
          id: entity?.id,
          name, slug, category, role, description,
          matchNames, relatedWork, externalUrl, sortOrder,
        })
      }
      router.push('/admin/entity')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
      setSaving(false)
    }
  }
```

- [ ] **Step 4: 既存の非song entity編集時に「楽曲」を選択肢から除外する**

既存の「カテゴリ」selectブロック（170〜185行目）を次のように変更（`CATEGORIES.map`の対象を`availableCategories`に差し替え）：

```tsx
            <label className={labelClass}>
              <span className={labelTextClass}>カテゴリ</span>
              <select
                className={inputClass}
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {CATEGORIES
                  .filter(c => c.value !== 'song' || !entity || entity.category === 'song')
                  .map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
              </select>
            </label>
```

（新規作成時（`entity === null`）は「楽曲」を含む全カテゴリを表示する。既存entity編集時は、現在のcategoryが既に`'song'`である場合のみ「楽曲」を表示し続け、それ以外の既存entityでは選択肢から除外する。これにより`song_id`を持たない行が`category='song'`で保存されようとするケースをUI側で防ぐ）

- [ ] **Step 5: category='song'選択時のUIを追加する**

既存の「カテゴリ」selectブロック（170〜185行目）の直後、「役割・肩書き」フィールドの前に追加：

```tsx
            {category === 'song' && !entity && (
              <SongPickerPanel
                songId={songId}
                onSongIdChange={setSongId}
                newSongFields={newSongFields}
                onNewSongFieldsChange={setNewSongFields}
                matchNames={matchNames}
                previewConfirmed={previewConfirmed}
                onPreviewConfirmedChange={setPreviewConfirmed}
              />
            )}
            {category === 'song' && entity?.songs && (
              <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
                <div className="px-5 py-4">
                  <h2 className="text-sm font-semibold">楽曲メタ情報</h2>
                  <p className="mt-1 text-xs text-gray-500">紐づけ先の楽曲は変更できません。メタ情報のみ編集できます。</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <label className={labelClass}>
                    <span className={labelTextClass}>曲名</span>
                    <input className={inputClass} value={songMeta.title} onChange={e => setSongMeta({ ...songMeta, title: e.target.value })} />
                  </label>
                  <label className={labelClass}>
                    <span className={labelTextClass}>アルバム/シングル名</span>
                    <input className={inputClass} value={songMeta.album} onChange={e => setSongMeta({ ...songMeta, album: e.target.value })} />
                  </label>
                </div>
              </div>
            )}
```

- [ ] **Step 6: 保存ボタンをsong用の確認ゲートに対応させる**

既存の保存ボタン（318〜325行目）の`disabled`条件を次のように変更：

```tsx
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting || (category === 'song' && !entity && !previewConfirmed && !songId)}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
            >
              {saving ? '保存中...' : '保存'}
            </button>
```

（注：ここでは簡略化のガードのみ入れる。プレビュー0件/21件以上でのチェックボックス必須化はSongPickerPanel内の`needsConfirmation`表示に委ねる。厳密なゲート——プレビュー未実行では保存不可——はStep 7で追加する）

- [ ] **Step 7: プレビュー未実行では保存不可にするガードを追加する**

Step 3の`handleSave`冒頭、category分岐の前に追加：

```tsx
    if (category === 'song' && !entity && !songId) {
      // 新規song作成時はプレビュー実行が必須（マッチプレビューボタンを押すとpreviewConfirmedの判定材料が揃う）
      // ヒット1〜20件のケースはpreviewConfirmed不要だが、SongPickerPanel側でpreviewが一度もnullのままなら
      // ここでは検知できないため、Step 6のdisabled条件（songIdなし文脈）と合わせて運用する
    }
```

上記は設計意図のコメントのみで実質的なガード変更は不要（Step 6の`disabled`条件が「新規作成でsongId未選択かつpreviewConfirmed=false」を止める設計のため）。既存song選択時（`songId`セット済み）は検索経由で既にDBにある曲なので、プレビュー未実行でも保存を許可する（重複登録リスクがないため）。

- [ ] **Step 8: entity/page.tsxのCATEGORY_LABELSを更新する**

`apps/web/src/app/admin/entity/page.tsx`の`CATEGORY_LABELS`（既存7〜15行目）を次のように変更：

```tsx
const CATEGORY_LABELS: Record<string, string> = {
  family: '家族・地元',
  celebrity: '交友・影響元',
  remixer: 'リミキサー',
  team: 'チーム',
  craftsman: '職人',
  product: 'コラボ製品',
  project: 'プロジェクト',
  song: '楽曲',
}
```

- [ ] **Step 9: 型チェックを実行する**

Run: `cd apps/web && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 10: dev serverを起動し、実際にブラウザで新規song entity作成を確認する**

Run: `cd apps/web && npm run dev`
手順：
1. `/admin/entity/new` にアクセス
2. カテゴリで「楽曲」を選択 → SongPickerPanelが表示されることを確認
3. 「夜の踊り子」で検索 → 完全一致候補が表示されることを確認
4. 候補を選択 → 選択済み表示に切り替わることを確認
5. name/slug/match_namesを入力（例: match_namesに`夜の踊り子`）
6. マッチプレビューを実行 → ヒット件数が表示されることを確認
7. 保存 → `/admin/entity`に遷移し、一覧に「楽曲」カテゴリが表示されることを確認
8. 公開ページ`/entity/<slug>`を開き、詳細が表示されることを確認
9. 既存の非song entity（例: 既存のcelebrity entity）の編集画面を開き、カテゴリselectに「楽曲」の選択肢が**表示されない**ことを確認
10. 作成したentityを削除して後片付け

Expected: 上記フローがエラーなく完了する

- [ ] **Step 11: コミット**

```bash
git add apps/web/src/app/admin/entity/[id]/EntityEditorClient.tsx apps/web/src/app/admin/entity/page.tsx
git commit -m "feat(entity): EntityEditorClientにcategory=songのUI統合、CATEGORY_LABELS更新"
```

---

## Task 12: 公開entityページでのsong情報表示

**Files:**
- Modify: `apps/web/src/app/entity/[slug]/page.tsx`
- Test: `apps/web/tests/public-entity-song-detail.spec.ts`

**Interfaces:**
- Consumes: Task 5で追加した`PUBLIC_ENTITY_DETAIL_SELECT`の`songs(...)`結合
- Produces: `/entity/[slug]`ページで`song_id`が紐づく場合のみalbum/track情報を追加表示

- [ ] **Step 1: 統合テストを書く**

```ts
// apps/web/tests/public-entity-song-detail.spec.ts
import { expect, test } from '@playwright/test'
import { getSupabaseServiceRoleClient } from './helpers/auth'
import { getTestEnv, getTestEnvSkipReason } from './helpers/env'

const testEnv = getTestEnv()

test.describe('public entity detail page song meta', () => {
  test.skip(!testEnv, getTestEnvSkipReason())
  test.skip(!testEnv?.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY が未設定です。')

  test('song entity detail page shows album info', async ({ page }) => {
    const service = getSupabaseServiceRoleClient()
    const slug = `public-song-detail-${Date.now()}`

    const { data: song, error: songError } = await service
      .from('songs')
      .insert({ title: '公開ページ確認曲', album: '確認用アルバム', disc_no: 1, track_no: 1 })
      .select('id')
      .single()
    expect(songError).toBeNull()

    const { data: entity, error: entityError } = await service
      .from('entities')
      .insert({
        slug,
        name: '公開ページ確認曲',
        match_names: ['＊公開ページ確認曲'],
        category: 'song',
        description: 'テスト説明',
        song_id: song!.id,
      })
      .select('id')
      .single()
    expect(entityError).toBeNull()

    try {
      await page.goto(`/entity/${slug}`)
      await expect(page.getByText('確認用アルバム')).toBeVisible()
    } finally {
      await service.from('entities').delete().eq('id', entity!.id)
      await service.from('songs').delete().eq('id', song!.id)
    }
  })

  test('non-song entity detail page does not show album section', async ({ page }) => {
    await page.goto('/entity')
    // 既存の非song entityの詳細ページに「確認用アルバム」のような楽曲メタ表記が出ないことを
    // スモークチェックする（既存entity一覧から1件開いて確認）
    const firstLink = page.locator('a[href^="/entity/"]').first()
    await firstLink.click()
    await expect(page.getByText(/Album|アルバム情報/)).toHaveCount(0)
  })
})
```

- [ ] **Step 2: テスト失敗を確認する**

Run: `cd apps/web && npx playwright test public-entity-song-detail.spec.ts`
Expected: FAIL（1件目：album情報が表示されない）

- [ ] **Step 3: entity/[slug]/page.tsxにsong情報表示を追加する**

`apps/web/src/app/entity/[slug]/page.tsx`の`EntityDetail`型（既存22行目）を次のように変更：

```ts
type EntitySongMeta = Pick<Song, 'album' | 'disc_no' | 'track_no' | 'released_at'>
type EntityDetail = Pick<Entity, 'id' | 'slug' | 'name' | 'category' | 'role' | 'description' | 'related_work' | 'external_url'> & {
  songs: EntitySongMeta | null
}
```

import文（既存6行目）を次のように変更：

```ts
import type { Entity, Song, Stream } from '@/lib/types'
```

既存の「Related Work」セクション（93〜98行目）の直後に追加：

```tsx
        {entity.category === 'song' && entity.songs && (
          <section className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-2">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">Album Info</p>
            <div className="text-sm text-gray-200 space-y-1">
              {entity.songs.album && <p>アルバム/シングル: {entity.songs.album}</p>}
              {(entity.songs.disc_no || entity.songs.track_no) && (
                <p>収録: {entity.songs.disc_no ?? '-'}枚目 / {entity.songs.track_no ?? '-'}曲目</p>
              )}
              {entity.songs.released_at && <p>発売日: {entity.songs.released_at}</p>}
            </div>
          </section>
        )}
```

- [ ] **Step 4: テストを再実行し成功を確認する**

Run: `cd apps/web && npx playwright test public-entity-song-detail.spec.ts`
Expected: PASS

- [ ] **Step 5: 全体のテストスイートを実行し、既存機能への影響がないことを確認する**

Run: `cd apps/web && npx playwright test`
Expected: 既存テストを含めて全件PASS

- [ ] **Step 6: 型チェック・lintを実行する**

Run: `cd apps/web && npx tsc --noEmit && npm run lint`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add apps/web/src/app/entity/[slug]/page.tsx apps/web/tests/public-entity-song-detail.spec.ts
git commit -m "feat(entity): 公開entityページにsong album情報を表示"
```

---

## 実装完了条件（Task 12完了後の最終確認）

- [ ] `docs/superpowers/specs/2026-07-13-song-entity-design.md`の§4.1〜§4.6・§8で確定した全項目が実装されている
- [ ] 「怪獣」または「夜の踊り子」を実際にentity登録し、対応するstreamのsummaryに`＊`マーカー表記を追記した上で、stream詳細ページで自動リンクされ`「」`表示に変換されることを手動確認する
- [ ] `TASKS.md`「ichiro-library: 実行経路のEvidence Gate導入＋runtime-map.md新設」の依存契約（entity経由songをGemini注入対象に含めるかは先に設計）が、本機能の実装によって損なわれていないことを確認する（`song_catalog.txt`・`summarize.py`に変更を加えていないことのgit diff確認）
