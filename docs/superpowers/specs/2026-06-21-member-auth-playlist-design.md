# 設計書：招待制メンバー認証＋プレイリスト編集機能

**作成日**: 2026-06-21  
**対象プロジェクト**: ichiro-library  
**ステータス**: Claude 第4回5エージェント検証済み・修正版（2026-06-21）

---

## 概要

ichiro-library に招待制のメンバー認証と、メンバーによるプレイリスト作成・編集機能を追加する。既存の単一パスワード管理（`ADMIN_PASSWORD`）を Supabase Auth に統一し、ロールベースの権限制御を導入する。ストリーム検索はタグ・エンティティ・日付フィルタを備え、ブックマーク機能で編集作業を補助する。

---

## 1. 認証アーキテクチャ

### 認証方式
- **Supabase Auth（メール + パスワード）に統一**
- 既存の `ADMIN_PASSWORD` Cookie 認証は段階的に廃止（移行期間中は並行稼働）
- 追加パッケージ：`@supabase/ssr`（Next.js App Router 対応のサーバーサイド認証）

### ロール
| ロール | 対象 | 人数 |
|--------|------|------|
| `admin` | 一幾のみ | 1名 |
| `editor` | 招待メンバー | 5〜10名程度 |

### ロール管理
- `raw_user_meta_data` への保存は**禁止**（ユーザーが `supabase.auth.updateUser()` で自己書き換え可能 → 権限昇格リスク）
- 独立した `user_roles` テーブルで管理。書き込みは service-role からのみ

### メンバー招待フロー
- admin が Supabase ダッシュボードでアカウントを手動作成
- `user_roles` テーブルに `role: 'editor'` を INSERT（service-role 経由）
- 招待メール機能は使用しない（SMTP 設定コスト回避）

---

## 2. 認可設計

### 認可の主担当：Server Action 層
- **認可は全 Server Action の先頭で `requireRole(['editor', 'admin'])` または `requireRole(['admin'])` により一元管理**
- service-role は既存通り継続使用（RLS をバイパス）
- RLS は「anon キー漏洩時の最後の砦」として公開読み取りテーブルにのみ最小限付与

```typescript
// リクエスト内メモ化（React.cache は引数なしでのみ確実に機能）
const verifySession = cache(async () => {
  // supabase.auth.getUser() でセッション取得
})
const getCurrentUserRole = cache(async (): Promise<'editor' | 'admin' | null> => {
  const session = await verifySession()
  // user_roles テーブルを service-role client で読む（RLS は書き込み保護用。読み取りは service-role で行う）
  // ロールが存在しない（権限剥奪済み）場合は null を返す
  return userRole  // 型: 'editor' | 'admin' | null
})

// 認可ヘルパ（毎回 DB を確認 → 権限剥奪が即反映される）
// ⚠️ 移行期ブリッジ fallback がある場合も、この関数を通る書き込み系 Action は
//    Supabase Auth セッション必須（session.user.id が存在しないと *_by 列の NOT NULL 違反になる）。
//    ブリッジ fallback を許容するのは GET 専用 DAL のみ。書き込み Action でブリッジを通さないよう
//    実装側でも必ず guard すること（Section 7・Section 3 の「旧Cookie ブリッジ経由では書き込み禁止」参照）
async function requireRole(rolesAllowed: ('editor' | 'admin')[]) {
  const [session, userRole] = await Promise.all([verifySession(), getCurrentUserRole()])
  if (!rolesAllowed.includes(userRole)) throw new Error('Forbidden')
  return { user: session.user, role: userRole }
}
```

### ルート保護：proxy.ts ＋ DAL の二段構成
- **`proxy.ts`（Next.js 16 での middleware の名称）**：Cookie の有無だけ見る optimistic なリダイレクト（DB チェックは行わない。唯一の防御線にしない）
- **`proxy.ts` はセッションリフレッシュも担う**：毎リクエストで `supabase.auth.getUser()` を呼び、更新された Cookie（`Set-Cookie`）をレスポンスに付与する。これがないと access token（デフォルト1時間）がサイレントに切れ、Server Action が突然 Unauthorized を返す
- **各ページ / Server Action の DAL**：`verifySession()` + `requireRole()` で本当の認可を行う
- `verifySession()` と `getCurrentUserRole()` をそれぞれ引数なしで `React.cache()` でリクエスト内メモ化（上記コード参照）。`requireRole(rolesAllowed)` への直接適用は配列引数でメモ化が機能しないため不可
- **Server Action は操作ごとに別リクエスト**のため、オートセーブ連打での DB 照合削減効果はない（性能上許容範囲と判断）

> ⚠️ Next.js 16.2.4 では `middleware.ts` は deprecated → `proxy.ts` を使用。実装時は `node_modules/next/dist/docs/` を正典とすること。

### セッション切れ時のハンドリング

- D&D 並び替え中・プレイリスト編集中にセッションが切れた場合：Server Action が Unauthorized を返したらクライアントは `/login?return=/member` へリダイレクト
- **`return` パラメータの検証必須**：ログイン成功後のリダイレクト先は `/` 始まりの相対パスのみ許可。`https://` / `//example.com` / 制御文字を含む値はフィッシング（open redirect）に悪用されるため `/` にフォールバックする

  ```typescript
  // ログイン後リダイレクト
  const returnTo = searchParams.get('return') ?? '/'
  // ⚠️ startsWith('/') だけでは /%0d%0a（CRLF）と /\evil.com（バックスラッシュ正規化）が通過する
  // \x5C (\) を許可しないよう \x20-\x5B / \x5D-\x7E に分割している
  const safe = /^\/(?![\/\\])[\x20-\x5B\x5D-\x7E]*$/.test(returnTo) ? returnTo : '/'
  redirect(safe)
  ```

- オートセーブ（後述）により編集中データは逐次保存されるため、セッション切れによる作業ロストは最小化される

### 権限剥奪時の即時失効

- `user_roles` 行を削除しても**発行済み JWT は有効期限まで生き続ける**
- 対策：`requireRole()` は毎回 `user_roles` テーブルを SELECT してロールを確認する（JWT クレームのみで判断しない）。これにより権限剥奪後の次リクエストで即座にブロックできる

### ログアウト

- `supabase.auth.signOut()` を呼び、全デバイスのセッションを失効させる
- 既存の `clearAdminSession()`（Cookie削除）は Supabase の signOut に置き換える

### 権限マトリクス
| 機能 | 未ログイン | editor | admin |
|------|-----------|--------|-------|
| プレイリスト閲覧 | ✅ | ✅ | ✅ |
| プレイリスト作成・編集・削除 | ❌ | ✅ | ✅ |
| エンティティ単語追加（申請） | ❌ | ✅申請のみ | ✅ |
| エンティティ申請の承認・却下 | ❌ | ❌ | ✅ |
| メンバー管理（追加・削除） | ❌ | ❌ | ✅（手動：Supabase ダッシュボード + SQL） |
| ストリーム管理・タグ操作 | ❌ | ❌ | ✅ |

**editor 間のプレイリスト権限**：全 editor が全プレイリストを編集・削除可（Wiki 型）。`created_by` / `updated_by` は記録し管理画面に表示する。

> **メンバー管理の実装スコープ**：今回 `/admin` に「メンバー管理タブ」は作らない。追加は Supabase ダッシュボードでアカウント作成 → `user_roles` テーブルへ手動 INSERT の2ステップで行う（SMTP 設定・招待メール不要）。削除は `user_roles` 行の剥奪のみとし `auth.users` は消さない（FK 破損防止）。

---

## 3. DBスキーマ（追加）

> **注意**: 全テーブルに `ALTER TABLE xxx ENABLE ROW LEVEL SECURITY;` が必須。migration SQL に必ず含めること。

### user_roles テーブル
```sql
CREATE TABLE user_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('editor', 'admin')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
-- entity_word_requests の RLS ポリシーが user_roles を EXISTS で参照するため GRANT が必須
GRANT SELECT ON user_roles TO authenticated;
-- requireRole() は service-role client で読むため、authenticated READ ポリシーは実行上不要だが念のため付与
CREATE POLICY "user_roles_self_read" ON user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- ⚠️ INSERT/UPDATE/DELETE は service-role からのみ（ポリシー未設定 = authenticated は書き込み不可）
-- 注意: user_id が PRIMARY KEY のため1ユーザー1ロール固定。複数ロールが将来必要になった時は (user_id, role) 複合PKへ変更する
```

### playlists テーブル
```sql
CREATE TABLE playlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL REFERENCES auth.users(id),  -- 作成者必須
  updated_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
-- updated_at 自動更新トリガー（既存の update_updated_at() 関数を流用）
CREATE TRIGGER playlists_updated_at
  BEFORE UPDATE ON playlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- RLS: 読み取りは全員OK（anon + authenticated）。書き込みは editor + admin のみ（service-role経由）
GRANT SELECT ON playlists TO anon;
GRANT SELECT ON playlists TO authenticated;
CREATE POLICY "playlists_public_read" ON playlists
  FOR SELECT TO anon USING (true);
CREATE POLICY "playlists_authenticated_read" ON playlists
  FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE は service-role からのみ（requireRole() で認可確認後）
```

### playlist_streams テーブル
```sql
CREATE TABLE playlist_streams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  stream_id   UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  position    NUMERIC(18,8) NOT NULL,  -- fractional indexing（精度拡張：同一隙間への中間挿入耐久回数を大幅増）
  added_by    UUID REFERENCES auth.users(id),
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (playlist_id, position) DEFERRABLE INITIALLY DEFERRED,  -- リバランス中の中間衝突を COMMIT 直前まで先送り
  UNIQUE (playlist_id, stream_id)  -- 同一ストリームの重複追加防止
);
ALTER TABLE playlist_streams ENABLE ROW LEVEL SECURITY;
-- RLS: 読み取りは全員OK（公開プレイリストの内容を anon も閲覧可能）
GRANT SELECT ON playlist_streams TO anon;
GRANT SELECT ON playlist_streams TO authenticated;
CREATE POLICY "playlist_streams_public_read" ON playlist_streams
  FOR SELECT TO anon USING (true);
CREATE POLICY "playlist_streams_authenticated_read" ON playlist_streams
  FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE は service-role からのみ
-- ⚠️ UNIQUE (playlist_id, position) が同キーのインデックスを自動生成するため、
--    CREATE INDEX idx_playlist_streams_order は不要（重複インデックス）。省略すること。
```

**position について**：`NUMERIC(18,8)` で fractional indexing を採用（`NUMERIC(12,4)` から拡張。同一隙間への中間挿入耐久回数が理論値 ~23回 → ~53回相当に改善）。初期値は `10000.00000000, 20000.00000000...` など大きな間隔で採番。並び替えは隣接2点の中間値を1行 UPDATE するだけで完結する。

**リバランス条件**：Server Action は並び替え時に隣接 position の gap を計算し、gap が `0.00000002` 以下（最小単位の2倍）になった場合にリバランスを実行する（`0.00000001` ちょうどで判定すると丸め誤差で既存 position と衝突するため early trigger）。リバランスは同一 `playlist_id` の全行を `10000, 20000, 30000...` に整数リセットしてから更新する（transaction 内）。`UNIQUE (playlist_id, position) DEFERRABLE INITIALLY DEFERRED` により、一括 UPDATE の中間状態で他行の旧値と一時的に衝突しても COMMIT 直前まで制約チェックが先送りされる（即時評価の UNIQUE 制約では途中行が既存値と被った瞬間にエラーになる）。リバランス自体は稀で、一般ユーザーには不可視。

**並行編集時のロック**：reorder / rebalance の transaction では、冒頭で `SELECT id FROM playlist_streams WHERE playlist_id = $1 ORDER BY position FOR UPDATE` を実行して同一 `playlist_id` の全行をロックする。これにより並行リバランス同士・リバランス中 reorder の衝突を防ぐ。

> ⚠️ **実装方式**：Supabase JS の `.from().update()` 連鎖では `BEGIN` / `FOR UPDATE` / `COMMIT` を含むトランザクションが実行できない。reorder・rebalance の Server Action は `SECURITY DEFINER` RPC（PostgreSQL 関数）として実装し、position 計算も JS の Number ではなく SQL `NUMERIC` 演算で完結させること（JS number は 15 桁の有効数字しかなく `NUMERIC(18,8)` の精度を維持できない）。

**並行書き込みの衝突ケース**：

| ケース | 制約 | 挙動 |
|--------|------|------|
| 同一 position に同時ドロップ | `UNIQUE (playlist_id, position)` | 後発が UNIQUE 違反 → クライアントリトライ |
| 同一 stream_id を重複追加 | `UNIQUE (playlist_id, stream_id)` | UNIQUE 違反 → エラー返却（重複追加は設計上不可） |
| reorder / rebalance の並行書き込み | `SELECT ... FOR UPDATE` による行ロック | 後発は先発の COMMIT まで待機してから実行 |

**stream_id について**：`streams(id)` UUID への FK を張ることで存在しないストリームを DB レベルで防ぐ。UI での入力は YouTube `video_id`（例：`dQw4w9WgXcQ`）で行い、サーバー側で `streams.video_id` を検索して `streams.id` UUID に変換してから保存する。

### bookmarks テーブル
```sql
CREATE TABLE bookmarks (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_id  UUID REFERENCES streams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, stream_id)
);
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_bookmarks_stream ON bookmarks(stream_id);
-- RLS: 本人行のみ読み書き可（bookmarks は anon からは不可視）
-- ⚠️ user_roles 行なし（権限剥奪済み）の authenticated ユーザーが直接呼び出せないよう EXISTS チェックを追加
GRANT SELECT, INSERT, DELETE ON bookmarks TO authenticated;
CREATE POLICY "bookmarks_self_access" ON bookmarks
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()));
```

- ログイン中の editor / admin のみ操作可能（未ログインには★ボタン非表示）
- 同一ストリームの重複ブックマークは PK 制約で防ぐ
- **ブックマーク取得は Server Action 経由のみ**（公開 RPC には乗せない → セクション8参照）

### entity_word_requests テーブル

```sql
CREATE TABLE entity_word_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    UUID NOT NULL REFERENCES entities(id),  -- NOT NULL 必須
  word         TEXT NOT NULL CHECK (word <> '' AND word = TRIM(word)),  -- 空白不可
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES auth.users(id),
  reviewed_by  UUID REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
ALTER TABLE entity_word_requests ENABLE ROW LEVEL SECURITY;
-- RLS: 自分の申請 + admin は全件読める。INSERT は authenticated のみ。UPDATE（承認/却下）は service-role のみ
-- ⚠️ user_roles 行なし（権限剥奪済み）の authenticated ユーザーが直接呼び出せないよう、
--    read・insert 両ポリシーに user_roles 存在チェックを追加
GRANT SELECT ON entity_word_requests TO authenticated;
GRANT INSERT ON entity_word_requests TO authenticated;
CREATE POLICY "entity_word_requests_read" ON entity_word_requests
  FOR SELECT TO authenticated USING (
    (requested_by = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );
CREATE POLICY "entity_word_requests_insert" ON entity_word_requests
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()));
-- UPDATE（承認/却下）は service-role からのみ（requireRole(['admin']) で認可確認後）
-- 部分ユニークインデックス：同一 entity + word の pending 申請は1件まで
CREATE UNIQUE INDEX ON entity_word_requests (entity_id, word) WHERE status = 'pending';
```

**承認の二重防止**：承認・却下アクションは `WHERE status = 'pending'` 条件付き UPDATE を使用。影響行数が 0 の場合はエラーを返す。

**承認後の反映先**：承認 Server Action は `status = 'approved'` に更新した後、`entities.match_names` に word を追加する：

```sql
-- 承認 Action 内（SECURITY DEFINER RPC 内、または supabase service-role で BEGIN/COMMIT を明示）
-- ① request 行をロック（entity_id と word を DB から取得。外部入力 $entityId/$word をそのまま使わずDB側で正当性を保証）
SELECT entity_id, word INTO $entityId, $word
  FROM entity_word_requests WHERE id = $requestId AND status = 'pending' FOR UPDATE;
-- ② entities 行を FOR UPDATE でロック（同一 word・別 request の並行承認による配列重複を防ぐ）
SELECT id FROM entities WHERE id = $entityId FOR UPDATE;
-- ③ entity_word_requests を承認（同一 request の二重承認は WHERE status='pending' で防ぐ）
UPDATE entity_word_requests SET status = 'approved', reviewed_by = $userId, reviewed_at = now()
  WHERE id = $requestId AND status = 'pending';
-- ③ match_names に追加（重複防止。updated_at は update_updated_at() トリガーが自動更新するため手動記述不要）
UPDATE entities SET match_names = array_append(match_names, $word)
  WHERE id = $entityId AND NOT ($word = ANY(match_names));
-- ⚠️ entities.match_names は TEXT[] 型。この列は 007_entities.sql に定義済み
```

**関連ルール**：

- **重複防止**：`NOT ($word = ANY(match_names))` で既存エイリアスと重複する場合は entities を更新しない（requests 側は approved にする）
- **同時承認（同一 request）**：2人の admin が同一 `entity_word_requests.id` を同時承認した場合、`WHERE status = 'pending'` 条件で片方は影響行数 0 → エラー返却
- **並行承認（同一 word・別 request）**：異なる request でも同じ `word` を持つ場合、`NOT ($word = ANY(match_names))` だけではチェックと追加が非アトミックで `match_names` に同一 word が2つ入る可能性がある。`SELECT ... FOR UPDATE` で entities 行をロックして直列化することで防ぐ（上記 SQL 参照）
- **却下後の再申請**：`rejected` 状態の申請は部分ユニークインデックスの対象外のため、同一 entity + word の新規 pending 申請が可能（再申請 OK）

### 監査証跡の規約
- `*_by` 列（`created_by`, `updated_by`, `added_by`, `requested_by`, `reviewed_by`）には各 Server Action 内で `requireRole()` から得た `user.id` を明示的に書き込む
- service-role 経由の書き込みであっても、認証済みユーザーの ID を明示することで「誰がやったか」を記録する

> ⚠️ **旧 Cookie ブリッジ経由では書き込み系 Server Action を禁止する**。ブリッジは Supabase Auth セッションを持たないため `requireRole()` が返す `user.id` が存在せず、`*_by` 列（FK 参照）に NULL 以外を書けない（NOT NULL 制約違反になるケースもある）。ブリッジ経由でアクセスできるのは GET 系（ダッシュボード閲覧・一覧取得）のみとし、データ変更操作は Supabase Auth でのログインを要求する。**ブリッジ経由 GET の DB ロール**：ブリッジは `authenticated` ロールで動作できないため **service_role を使用する**（RLS をバイパス）。`transcript` 列も読み取り可能になるが、ブリッジは admin 専用であり管理者は transcript を閲覧可能な運用とする（設計上許容）。ブリッジ経由 GET でも safe column list を使用して不要な列取得を避けること。

### `authenticated` ロールの READ 権限

既存の公開 RLS ポリシーは `TO anon` で付与されており、ログイン後のクライアントは `authenticated` ロールで動作する。**`GRANT` だけでは RLS が通らない**。GRANT と RLS policy は別物で、両方が必要。migration で以下を追加すること：

```sql
-- ① テーブルレベルの GRANT（行アクセスの前提）
GRANT SELECT ON streams        TO authenticated;
GRANT SELECT ON chapters       TO authenticated;
GRANT SELECT ON entities       TO authenticated;
GRANT SELECT ON stream_entities TO authenticated;
GRANT SELECT ON magazine_entities TO authenticated;
GRANT SELECT ON magazines      TO authenticated;
GRANT EXECUTE ON FUNCTION search_streams TO authenticated;

-- ② RLS policy（行レベルのフィルタ）
-- 既存の TO anon policy を TO anon, authenticated に変更、または authenticated 用を追加
CREATE POLICY "streams_authenticated_read" ON streams
  FOR SELECT TO authenticated USING (status IN ('public', 'unlisted'));

CREATE POLICY "chapters_authenticated_read" ON chapters
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM streams s WHERE s.id = stream_id AND s.status IN ('public', 'unlisted')
  ));
-- ⚠️ USING (true) は使用しない。transcript_segment の REVOKE が漏れた際に全章が露出するため、
--    chapters は必ず親 streams の status フィルタを通すこと

-- ⚠️ 001_initial_schema.sql の chapters_anon_read は USING(true) のまま残存しているため migration で差し替える
DROP POLICY IF EXISTS "chapters_anon_read" ON chapters;
CREATE POLICY "chapters_anon_read" ON chapters
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM streams s WHERE s.id = stream_id AND s.status IN ('public', 'unlisted')
  ));

-- entities, stream_entities, magazines 等も同様に追加（borma が全テーブル横断確認）

-- 新規テーブルの GRANT + RLS（playlists / playlist_streams は上記 CREATE TABLE 直後に記載済み）
-- bookmarks / entity_word_requests も上記 CREATE TABLE 直後に記載済み
-- migration 採番は 012 以降を使用すること（既存は 011 まで）

-- ③ ⚠️ transcript 列の REVOKE を authenticated にも適用
--    anon 向け REVOKE は authenticated に引き継がれない。これを漏らすとログイン後のユーザーが
--    全文書き起こしを読める。
REVOKE SELECT (transcript)         ON streams  FROM authenticated;
REVOKE SELECT (transcript_segment) ON chapters FROM authenticated;
```

borma が migration 作成時に ① GRANT・② RLS policy・③ transcript REVOKE の3層を全テーブル横断で確認すること。

### `select('*')` 禁止ルール

> ⚠️ `transcript` / `transcript_segment` は列レベル REVOKE で隠しているが、Supabase JS で `.select('*')` を使うと Postgres がエラーを返す（列権限エラー）か、将来の実装変更で漏洩するリスクがある。**公開・member 側の `streams` / `chapters` クエリは safe column list を明示すること。`fetchBookmarkedStreams` は service-role で実行されるため REVOKE が効かない。service-role を使うすべての `streams`/`chapters` SELECT も safe column list を徹底すること。**

```typescript
// NG
supabase.from('streams').select('*')

// OK — transcript を含まない列だけ指定
supabase.from('streams').select(
  'id, video_id, title, stream_date, duration_min, view_count, summary, tags, corner_names, guests, youtube_url, thumbnail_url, avg_rating, rating_count'
)
```

`search_streams` RPC は SECURITY DEFINER 内で transcript を使用するが、返却列に transcript は含まないため安全。

---

## 4. ページ構成

| パス | 対象 | 内容 |
|------|------|------|
| `/login` | 全員 | メール＋パスワードのログインフォーム。ログイン後は role に応じて `/admin`（admin）または `/member`（editor）へリダイレクト |
| `/member` | editor + admin | プレイリスト管理タブ、エンティティ単語申請タブ |
| `/playlist/[id]` | 公開 | プレイリスト詳細ページ（スティッキープレイヤー＋カードリスト） |
| `/admin`（既存拡張） | admin のみ | 既存機能＋エンティティ申請承認キュー追加（メンバー管理タブは今回作らない） |
| `/`（既存拡張） | 公開 | カテゴリセクション下にプレイリストセクション追加 |
| `proxy.ts`（新規） | - | 未認証ユーザーの `/member`, `/admin` へのアクセスを optimistic リダイレクト |

---

## 5. プレイリスト編集 UI（/member）

```
[プレイリスト管理]  [エンティティ申請]  ← タブ切り替え

プレイリスト管理タブ：
  [+ 新しいプレイリストを作成]
  ──────────────────────────────────────────
  🎮 ドラクエ11 スタート〜エンド  [編集] [削除]
     作成：editor@example.com ／ 2026-06-20 ／ 全8本
```

**プレイリスト編集画面：**

```
タイトル: [___________________]
説明:     [___________________]

ストリームを追加：
  [タイトル・AI要約で検索___] [タグ ▼] [エンティティ ▼] [日付 ▼] [検索]
  または YouTube動画ID: [dQw4w9WgXcQ] [追加]

  検索結果：
    ドラクエ11 初見①（dQw4w9WgXcQ）  #ゲーム実況 #ドラクエ11  [追加]
    ドラクエ11 初見②（abc1234defg）   #ゲーム実況 #ドラクエ11  [追加]

  ★ ブックマーク済みのみ表示  [フィルタ切替]
    ドラクエ11 初見③（ghi5678jklm）  [追加]

プレイリスト内容：（ドラッグ&ドロップで並び替え）
  ≡ #1  ドラクエ11 初見①  (dQw4w9WgXcQ)  [削除]
  ≡ #2  ドラクエ11 初見②  (abc1234defg)  [削除]
```

**検索フィルタの仕様：**

- テキスト検索：`search_streams` RPC（既存）が担当。現行 RPC はすでに title / summary / transcript / chapters を対象にしているため検索能力の変更なし
- タグ：`streams.tags`（カテゴリタグ）を参照。`streams.talk_topics`（トーク話題）は将来拡張
- エンティティ：`entities` テーブルから名前で絞り込み（例：「ドラクエ11」）
- 日付：配信日の範囲指定
- フィルタは AND 条件で組み合わせ可

**ブックマークフィルタ：**

- 「ブックマーク済みのみ表示」に切り替えると自分がブックマークしたストリームだけが検索対象になる
- [★] ボタンの配置：既存 `StreamCard` はカード全体が `<Link>`（`<a>` タグ）のためボタンをネストすると HTML 仕様違反。公開ページ（`/`・検索結果）でも StreamCard をラップしたカスタムコンポーネント（`BookmarkableStreamCard` 等）を作成し、★ボタンはカード外部に絶対配置または card 自体を div ベースにリファクタリングする。既存 `StreamCard` は変更しない

**その他：**

- 並び替え：`@dnd-kit/core` + `@dnd-kit/sortable` を使用
- `video_id` はメンバー画面の検索結果に表示。YouTube URL（`watch?v=...`）からも確認可能

---

## 6. プレイリスト閲覧 UI（/playlist/[id]）

**スティッキープレイヤー方式**（ページ遷移なし）：

```
┌─────────────────────────────────────────┐
│  ▶ YouTube 埋め込みプレイヤー           │  ← 上部固定
│    再生中：ドラクエ11 初見②            │
└─────────────────────────────────────────┘

🎮 ドラクエ11 スタート〜エンド　全8本
2026-06-20

✓ #1  [サムネイル] ドラクエ11 初見①  ─ 2023-04-01 ・ 2.1万再生
▶ #2  [サムネイル] ドラクエ11 初見②  ─ 2023-04-08 ・ 1.8万再生（再生中）
  #3  [サムネイル] ドラクエ11 初見③  ─ 2023-04-15 ・ 1.5万再生
  ...
```

- 既存の `StreamCard` を**流用しない**。プレイリスト専用カードコンポーネントを作成（理由：既存 `StreamCard` はカード全体が `<a>` タグ。★ボタン等の操作 UI をネストすると HTML 仕様違反）
- YouTube embed は既存の `/stream/[id]` と同じ `youtube.com/embed/${video_id}?rel=0&enablejsapi=1&origin=...` を使用（IFrame API 有効化が必要）
- プレイリストが存在しない場合は `not-found.tsx` で 404 を返す

**トップページのプレイリストセクション：**
```
プレイリスト
  [サムネイル]             [サムネイル]             [サムネイル]
  ドラクエ11全編           FF7リメイク              ...
  全8本                   全12本
```

> 作成者名（"by editor名"）は公開画面では**表示しない**。`auth.users` を公開側から安全に JOIN できないため。`created_by` は `/member` 管理画面（ログイン済み）でのみ表示する。

---

## 7. 移行方針

### 移行対象の正確な箇所（草薙調査）

「26本」ではなく実態は以下の通り：

- `actions.ts` 内 `requireAdminSession()` 呼び出し：**14箇所**（関数単位で差し替え）
- ページ DAL 側 `checkAdminSession()` 直呼び：**2箇所**（`admin/entity/page.tsx` + `admin/entity/[id]/page.tsx`）
- クライアント hook `useAdminAuth.ts`：**1ファイル廃止**（ただし廃止は下記の server-first 再設計完了後）

> ⚠️ `/admin/page.tsx` と `/admin/stream/[id]` は Server 側で認証していない（client-side `useAdminAuth` 経由）。これらは「関数差し替え」ではなく **server-first への構造置き換え**が必要で、**別工程として計画すること**（本移行タスクには含めない）。`useAdminAuth.ts` の削除はこの2ページの server-first 置き換えが完了するまで行わない。

移行前にこの16箇所（14+2）＋構造置き換え2ページのリストを確定し、各々の差し替え先を1対1で対応表にすること。

### 段階的切替（ロックアウト防止）

1. Supabase Auth 導入・`user_roles` テーブル作成・`proxy.ts` 新規作成
2. **一幾の admin アカウントを先に作成**してから旧 Cookie 認証の廃止へ進む
3. `requireRole()` ヘルパ新規作成。**並行稼働期間中は旧 Cookie 認証も一時的にフォールバックとして受理するブリッジ**を噛ませ、切替中に管理画面が半壊しないようにする。ブリッジの廃止条件は以下を全て満たしたとき：①全ページの切替完了、②一幾が `/admin` での動作を確認、③`ADMIN_PASSWORD` env var の削除準備完了。ブリッジは **admin ロールのみ**に適用（editor は Supabase Auth 専用）。ブリッジ稼働中は、**`requireRole(['admin'])` 内の fallback 経路そのものに** `console.warn('[auth-bridge] 旧 Cookie 認証フォールバック使用 userId=xxx')` を記録する（Server Action ログだけでは、ページ DAL 経由の fallback 使用が漏れるため）
4. 既存の `requireAdminSession()` / `checkAdminSession()` を `requireRole(['admin'])` に**ページ単位**で切替（関数1本ずつではなくページ単位で一括切替することで、半端な状態を避ける）
5. 全ページの切替完了後 **7日間**（一幾が `/admin` を毎日使用して問題なし）を目安に `ADMIN_PASSWORD` env var を削除する。期間・確認者・確認ログの明記：一幾が 7日後に Next.js ログで `auth-bridge` 行がゼロであることを確認してから削除を実行する。
   > ⚠️ XServer の Node.js ログはローテーション設定によっては 7日以内に古いログが切り捨てられる可能性がある。事前に `pm2 logs --lines 10000` 等で保持期間を確認し、必要なら `ADMIN_PASSWORD` 削除前日に手動でログをエクスポートしてから削除を実行すること
6. 旧 `useAdminAuth.ts` / `verifyAdminPassword` / `clearAdminSession` を削除

### ロールバック手順

- 手順5（`ADMIN_PASSWORD` 削除）実行前まではいつでも旧認証に戻せる
- `user_roles` テーブルと旧 Cookie ロジックは手順6まで残す

### 最初の admin 作成手順（シード）
```sql
-- Supabase Auth でアカウント作成後、user_roles に手動 INSERT
INSERT INTO user_roles (user_id, role, granted_by)
VALUES ('<一幾のauth.users.id>', 'admin', '<一幾のauth.users.id>');
```

---

## 8. 検索アーキテクチャ

既存の `search_streams` RPC（`SECURITY DEFINER`、anon に EXECUTE 付与済み）を**拡張して一本化**する。新たな検索系統は追加しない。

### 現行 RPC の検索範囲（変更なし）

既存 RPC はすでに以下を検索しており、追加・変更しない：

- `streams.title`（タイトル）
- `streams.summary`（AI要約）
- transcript セグメント
- chapters タイトル

### search_streams RPC の修正全文

> ⚠️ `CREATE OR REPLACE FUNCTION` は**全文置換**。「引数を追加するだけ」という実装は不可。既存の引数・返却列・本体を一字一句変えずに丸ごと再掲し、差分（`filter_entity_id` 追加と WHERE 句への JOIN）のみ足すこと。

```sql
-- 012_member_auth.sql（または適切な migration 番号）に記載
-- ⚠️ 旧9引数版を先に削除（オーバーロード防止：PostgreSQL は引数型が異なると別関数として登録するため旧版が残存する）
DROP FUNCTION IF EXISTS public.search_streams(
  TEXT, DATE, DATE, TEXT[], TEXT[], TEXT[], TEXT, INTEGER, INTEGER
);
CREATE OR REPLACE FUNCTION search_streams(
  query          TEXT,
  date_from      DATE    DEFAULT NULL,
  date_to        DATE    DEFAULT NULL,
  filter_tags    TEXT[]  DEFAULT NULL,
  filter_corners TEXT[]  DEFAULT NULL,
  filter_guests  TEXT[]  DEFAULT NULL,
  sort_by        TEXT    DEFAULT 'date_desc',
  page_num       INTEGER DEFAULT 1,
  page_size      INTEGER DEFAULT 20,
  filter_entity_id UUID  DEFAULT NULL   -- ← 今回追加
)
RETURNS TABLE (
  id            UUID,
  video_id      TEXT,
  title         TEXT,
  stream_date   DATE,
  duration_min  INTEGER,
  view_count    INTEGER,
  summary       TEXT,
  tags          TEXT[],
  corner_names  TEXT[],
  guests        TEXT[],
  youtube_url   TEXT,
  thumbnail_url TEXT,
  avg_rating    NUMERIC,
  rating_count  INTEGER,
  total_count   BIGINT
) AS $$
DECLARE
  offset_val INTEGER := (page_num - 1) * page_size;
BEGIN
  RETURN QUERY
  WITH matched AS (
    SELECT s.id
    FROM streams s
    WHERE
      s.status IN ('public', 'unlisted')
      AND (query IS NULL OR query = '' OR (
        s.title            ILIKE '%' || query || '%'
        OR s.summary       ILIKE '%' || query || '%'
        OR s.transcript    ILIKE '%' || query || '%'
        OR EXISTS (
          SELECT 1 FROM chapters c
          WHERE c.stream_id = s.id
            AND (
              c.title              ILIKE '%' || query || '%'
              OR c.transcript_segment ILIKE '%' || query || '%'
            )
        )
      ))
      AND (date_from       IS NULL OR s.stream_date >= date_from)
      AND (date_to         IS NULL OR s.stream_date <= date_to)
      AND (filter_tags     IS NULL OR s.tags        @> filter_tags)
      AND (filter_corners  IS NULL OR s.corner_names @> filter_corners)
      AND (filter_guests   IS NULL OR s.guests       @> filter_guests)
      AND (filter_entity_id IS NULL OR EXISTS (   -- ← 今回追加
        SELECT 1 FROM stream_entities se
        WHERE se.stream_id = s.id AND se.entity_id = filter_entity_id
      ))
  ),
  total AS (SELECT COUNT(*) AS cnt FROM matched)
  SELECT
    s.id,
    s.video_id,
    s.title,
    s.stream_date,
    s.duration_min,
    s.view_count,
    s.summary,
    s.tags,
    s.corner_names,
    s.guests,
    s.youtube_url,
    s.thumbnail_url,
    s.avg_rating,
    s.rating_count,
    t.cnt AS total_count
  FROM streams s
  JOIN matched m ON s.id = m.id
  CROSS JOIN total t
  ORDER BY
    CASE WHEN sort_by = 'date_desc'  THEN s.stream_date  END DESC,
    CASE WHEN sort_by = 'date_asc'   THEN s.stream_date  END ASC,
    CASE WHEN sort_by = 'view_count' THEN s.view_count   END DESC NULLS LAST,
    CASE WHEN sort_by = 'rating'     THEN s.avg_rating   END DESC NULLS LAST,
    s.stream_date DESC
  LIMIT page_size OFFSET offset_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_streams TO anon;
GRANT EXECUTE ON FUNCTION search_streams TO authenticated;
```

### ブックマークフィルタの分離（重要）

> ⚠️ **`bookmark_user_id` は公開 `search_streams` RPC に追加しない。**  
> 理由：既存 RPC は `SECURITY DEFINER + GRANT EXECUTE TO anon` であり、anon が任意 UUID を渡せると他人のブックマーク集合を取得できる（bookmarks RLS を横から破る）。

ブックマークフィルタは **Server Action として独立実装**する：

```typescript
// member 専用 Server Action（requireRole でログイン必須）
async function fetchBookmarkedStreams(filters: StreamFilters) {
  const { user } = await requireRole(['editor', 'admin'])
  // service-role client で bookmarks → streams を JOIN
  // ⚠️ service-role は REVOKE が効かないため transcript を含まない safe column list を必ず使用すること
  // anon RPC は呼ばない
}
```

> ⚠️ **ブックマークフィルタ ON 時のテキスト検索制限**：`fetchBookmarkedStreams` は `bookmarks → streams` の JOIN のみ行い、`search_streams` RPC（transcript/chapters を全文検索）は呼ばない。そのため、ブックマークフィルタを ON にした状態では transcript/chapters を含む全文テキスト検索は機能しない（タイトル・要約 + フィルタ条件のみ）。この制限はセキュリティ上の設計判断であり、UI に「テキスト検索はタイトル・要約のみ対象」と注記すること。

これにより検索系統は anon用RPC（entity フィルタ拡張版）1本 ＋ member用 Server Action 1本に整理される。

---

## 9. UX 仕様（確定）

### オートセーブ

- 追加・削除・並び替えの操作が完了するたびに**即時自動保存**
- 編集画面の上部に常時「✓ 保存済み」「● 保存中…」を表示（sticky ヘッダーまたは操作行単位の pending 表示）
- セッション切れで保存失敗した場合は「⚠ 保存失敗 — ログインし直してください」を表示

**Server Action の競合制御**：playlist 編集 Action は操作種別（追加 / 削除 / 並び替え / title 更新）ごとに独立した Action とし、各 Action は `playlist_id` + `updated_at`（楽観ロック）を受け取る。`updated_at` が DB と一致しない場合は `409 Conflict` を返しクライアント側でリロードを促す。title / description の保存は **blur イベント**で発火（debounce ではなく明示的フォーカス離脱時）。

> ⚠️ **楽観ロック（409）と UNIQUE 違反（リトライ）の適用場面の違い**：409 は「別クライアントが先に playlist を更新した」検知に使う（playlists.updated_at を Action の冒頭で照合）。UNIQUE 違反（`UNIQUE(playlist_id, position)` エラー）は「同一 position gap に複数クライアントが同時にドロップした」ときに後発側が受け取り、クライアントが自身でリトライする。楽観ロックは playlist ヘッダーレベルの競合制御、UNIQUE 違反は reorder RPC 内の行レベル競合制御であり、両方が独立して機能する（詳細はセクション3「並行書き込みの衝突ケース」参照）。

> ⚠️ **子テーブル更新時の `playlists.updated_at` 伝播**：`playlist_streams` の追加 / 削除 / reorder を行う全 Server Action は、操作後に `UPDATE playlists SET updated_at = now(), updated_by = $userId WHERE id = $playlistId` を必ず実行すること。これがないと playlist_streams の変更が `playlists.updated_at` に反映されず、title 保存と並行した reorder/add/delete の競合を 楽観ロックが検知できない。

### モバイル対応

- D&D はデスクトップ専用。`@dnd-kit` は `pointer: coarse` 環境で **sensor を登録しない**（CSS 非表示ではなく sensor レベルで除外）。モバイルでは各エピソード行に **↑ / ↓ ボタン**を表示する
- ↑↓ボタンの仕様：先頭行の ↑ と末尾行の ↓ は `disabled`。ボタン押下後（保存完了まで）は**全行の↑↓ボタンをすべて `disabled`** にして全 reorder 操作を停止する（「その行だけ」disabled では連続操作で順序が逆転する）。保存完了後に disabled 解除
- スティッキープレイヤーのスクロール縮小（shrink on scroll）：縮小後の高さは `56px`（16:9 比率を維持せず固定高）、`top: 0` sticky。iOS Safari の `position: sticky` は `overflow: scroll` の親がいると効かないため、リスト部分は `overflow-y: auto` を持つラッパーを設ける
- タブのタップ領域は最低 44px 確保

### ブックマーク表示制御

- [★] ボタンは**ログイン中の editor / admin のみ表示**。未ログインには非表示

### 最終エピソード後の処理

- YouTube iframe に `rel=0` パラメータを付与し、再生終了後の関連動画表示をオフ
- 最終エピソード再生終了後に「このプレイリストはここまでです」メッセージをオーバーレイ表示
- 終了検知には YouTube IFrame API（`enablejsapi=1` + `origin` 指定）を使用。既存 `/stream/[id]` の単純 iframe 埋め込みとは別実装になる

**YouTube IFrame API の実装要件**（`/playlist/[id]` 専用）：

- `<script src="https://www.youtube.com/iframe_api">` をページ head に追加
- `window.onYouTubeIframeAPIReady` コールバックで `YT.Player` インスタンスを生成
- embed URL：`https://www.youtube.com/embed/${video_id}?rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
- iframe に `allow="autoplay; encrypted-media"` 属性を付与
- 動画切替時（別エピソードを選択）：現在の `YT.Player` を `player.destroy()` してから新しいインスタンスを生成（`loadVideoById` はオートプレイ挙動が不安定なため）
- `onStateChange` イベントで `YT.PlayerState.ENDED` を検知して次エピソード or オーバーレイを制御

### 再生済みマーク

- `localStorage` にブラウザローカルで保持
- 閲覧ページに「再生状況はこのブラウザのみで保持されます」を一行表示

### 今回スコープ外（将来課題）

- プレイリストの公開 / 下書き状態
- プレイリストのカバー画像
- 全話連続再生ボタン
- エピソード単位シェアボタン

---

## 10. 追加パッケージ

| パッケージ | 用途 |
|-----------|------|
| `@supabase/ssr` | Next.js App Router 対応のサーバーサイド認証 |
| `@dnd-kit/core` | D&D コア |
| `@dnd-kit/sortable` | ソータブルリスト |

---

## 11. テスト要件（togusa 担当）

権限マトリクスを Server Action 単位・route 単位・RLS 単位で確認する。以下の全セルを E2E テストでカバーすること。

| テスト対象 | 未ログイン | editor | admin | 備考 |
|-----------|-----------|--------|-------|------|
| `GET /member` | 302 → `/login` | 200 | 200 | proxy.ts redirect |
| `GET /admin` | 302 → `/login` | 200（proxy.ts通過）→ DAL で 403 | 200 | proxy.ts はロール非判定。`requireRole(['admin'])` が 403 を投げる |
| playlist 作成 Server Action | 401 | 200 | 200 | `requireRole(['editor','admin'])` |
| playlist 削除 Server Action | 401 | 200（他者作成も可） | 200 | Wiki 型 |
| playlist reorder Server Action | 401 | 200 | 200 | SELECT FOR UPDATE 確認 |
| bookmark toggle Server Action | 401 | 200 | 200 | `user.id` で本人行のみ |
| `fetchBookmarkedStreams` Server Action | 401 | 200（本人のみ） | 200（本人のみ） | 他者 UUID を渡せないこと |
| entity word request 申請 | 401 | 200 | 200 | |
| entity word request 承認/却下 | 401 | 403 | 200 | `requireRole(['admin'])` |
| 旧 Cookie ブリッジ fallback | - | 403（editor 不可） | 200 | ブリッジは admin 限定 |
| `search_streams` RPC（anon） | 200 | 200 | 200 | transcript 列が返らないこと |
| `bookmarks` テーブル直接 SELECT（anon key） | 権限エラー（42501） | - | - | `GRANT SELECT TO anon` なし → RLS 到達前に拒否 |
| Supabase Auth セッション有効 + `user_roles` 行なし（権限剥奪済み） | - | 403（proxy.ts通過後 DAL でブロック） | 403（proxy.ts通過後 DAL でブロック） | 旧 Cookie ブリッジとは別概念。有効な Supabase Auth セッションがあっても user_roles 行が削除されていれば requireRole() が null を返しブロック |

> ⚠️ **`GET /member` における権限剥奪済みユーザーの挙動**：proxy.ts は Cookie の有無しか見ないため 200 を返してページを表示しようとする。しかし当該ページの Server Component / Server Action は `requireRole()` → `getCurrentUserRole()` が `null` を返すためブロックされる。「proxy.ts は 200 を通すが、ページ内の認可で弾かれる」という二段構成の挙動が正しい動作。テストは DAL 層（Server Action / `requireRole()`）で 403 を確認すること。

> ⚠️ **`GET /admin` の移行フェーズ前提**：上記テスト表の `admin = 200` は server-first 置き換え完了後の期待値。ブリッジ稼働中（`useAdminAuth.ts` が残存している状態）では `/admin/page.tsx` 自体は旧認証で動作するため期待値が異なる。テスト実施時点の移行フェーズ（Phase 1〜5）を明示してから実行すること。

**追加検証項目**：

- `playlist_streams` 変更後に `playlists.updated_at` が更新されることを確認（楽観ロック親更新）
- 並行リバランステスト：2クライアントが同時に reorder を行い、最終状態の order が一意であること（再現 fixture: `position` gap が `0.00000002` 以下の状態を seed データで作成してから2クライアントを同時起動する）
- 同一 position への同時ドロップ：2クライアントが同じ隙間にドロップし、後発が UNIQUE 違反でリトライすること
- `authenticated` ユーザーが `transcript` / `transcript_segment` 列を取得できないこと（REVOKE 確認）
  - `editor` セッションで `supabase.from('streams').select('transcript')` を直接呼び、PostgREST 経由で列権限エラー（42501）が返ること
  - `editor` セッションで `supabase.from('chapters').select('transcript_segment')` を直接呼び、PostgREST 経由で列権限エラー（42501）が返ること
  - これらは migration テスト（psql で `authenticated` ロールに SET ROLE してから確認）として分離することを推奨
- `entity word request` 承認後、対象 `entities.match_names` に word が追加されていること
- 承認対象 word が既に `match_names` に含まれる場合、`entities` 行は更新されず重複が生じないこと
- 2人の admin が同一 word・別 request を並行承認した場合、`match_names` に同一 word が2つ入らないこと（`FOR UPDATE` ロック確認）
- `return=https://evil.com` → ログイン後 `/` にリダイレクトされること
- `return=//evil.com` → ログイン後 `/` にリダイレクトされること
- `return=/member` → ログイン後 `/member` にリダイレクトされること（正常系）
- `return=/%0d%0aSet-Cookie:%20session=evil` → ログイン後 `/` にリダイレクトされること（CRLF インジェクション・制御文字を含む open redirect 防止）
- `return=/\evil.com` → ログイン後 `/` にリダイレクトされること（バックスラッシュ正規化による open redirect 防止）
- `return=/%5C%5Cevil.com` → ログイン後 `/` にリダイレクトされること（URL エンコードされたバックスラッシュの防止）
- Cookie ブリッジ廃止後（手順5完了後）、旧 Cookie で `/admin` にアクセスできないこと
- `user_roles` 行なし（権限剥奪済み）の authenticated セッションで `bookmarks` を Supabase JS で直接 SELECT → 0行が返ること（RLS で弾かれる）
- `user_roles` 行なし（権限剥奪済み）の authenticated セッションで `bookmarks` に直接 INSERT → RLS の WITH CHECK 違反でエラーになること
- `user_roles` 行なし（権限剥奪済み）の authenticated セッションで `entity_word_requests` を直接 SELECT → 0行が返ること（RLS で弾かれる）
- `user_roles` 行なし（権限剥奪済み）の authenticated セッションで `entity_word_requests` に直接 INSERT → RLS の WITH CHECK 違反でエラーになること

---

## 12. 実装担当（案）

| 担当 | 内容 |
|------|------|
| borma | DBスキーマ（migration SQL）・RLS ポリシー・`search_streams` RPC 拡張 |
| ishikawa | 認可レイヤ（`requireRole`・`verifySession`・`proxy.ts`）・Server Actions・移行ブリッジ |
| paz | `/member`・`/playlist/[id]`・トップページ プレイリストセクション・オートセーブ UI・モバイル対応 |
| togusa | セクション11 テスト要件の全セルを E2E 実装・移行並行稼働テスト・回帰テスト |
