# 設計書：招待制メンバー認証＋プレイリスト編集機能

**作成日**: 2026-06-21  
**対象プロジェクト**: ichiro-library  
**ステータス**: 承認済み（最終版 2026-06-21 レビュー反映済み）

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
- **認可は全 Server Action の先頭で `requireRole('editor' | 'admin')` により一元管理**
- service-role は既存通り継続使用（RLS をバイパス）
- RLS は「anon キー漏洩時の最後の砦」として公開読み取りテーブルにのみ最小限付与

```typescript
// 認可ヘルパの方針（実装詳細は ishikawa へ委任）
async function requireRole(role: 'editor' | 'admin' | ('editor' | 'admin')[]) {
  const session = await verifySession()      // Supabase Auth セッション取得
  const userRole = await getUserRole(session.user.id)  // user_roles テーブルから取得
  if (!rolesAllowed.includes(userRole)) throw new Error('Forbidden')
  return { user: session.user, role: userRole }
}
```

### ルート保護：proxy.ts ＋ DAL の二段構成
- **`proxy.ts`（Next.js 16 での middleware の名称）**：Cookie の有無だけ見る optimistic なリダイレクト（DB チェックは行わない。唯一の防御線にしない）
- **`proxy.ts` はセッションリフレッシュも担う**：毎リクエストで `supabase.auth.getUser()` を呼び、更新された Cookie（`Set-Cookie`）をレスポンスに付与する。これがないと access token（デフォルト1時間）がサイレントに切れ、Server Action が突然 Unauthorized を返す
- **各ページ / Server Action の DAL**：`verifySession()` + `requireRole()` で本当の認可を行う
- `requireRole()` は `React.cache()` でリクエスト内メモ化し、1リクエストあたり DB 往復を1回に抑える

> ⚠️ Next.js 16.2.4 では `middleware.ts` は deprecated → `proxy.ts` を使用。実装時は `node_modules/next/dist/docs/` を正典とすること。

### セッション切れ時のハンドリング

- D&D 並び替え中・プレイリスト編集中にセッションが切れた場合：Server Action が Unauthorized を返したらクライアントは `/login?return=/member` へリダイレクト
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
| メンバー管理（追加・削除） | ❌ | ❌ | ✅ |
| ストリーム管理・タグ操作 | ❌ | ❌ | ✅ |

**editor 間のプレイリスト権限**：全 editor が全プレイリストを編集・削除可（Wiki 型）。`created_by` / `updated_by` は記録し管理画面に表示する。

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
-- RLS: 書き込みは service-role のみ。本人行の読み取りのみ許可
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
-- RLS: 読み取りは全員OK。書き込みは editor + admin のみ（service-role経由）
```

### playlist_streams テーブル
```sql
CREATE TABLE playlist_streams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  stream_id   UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  position    NUMERIC(12,4) NOT NULL,  -- fractional indexing（精度固定）
  added_by    UUID REFERENCES auth.users(id),
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (playlist_id, position),
  UNIQUE (playlist_id, stream_id)  -- 同一ストリームの重複追加防止
);
ALTER TABLE playlist_streams ENABLE ROW LEVEL SECURITY;
-- 順序取得クエリ用インデックス
CREATE INDEX idx_playlist_streams_order ON playlist_streams(playlist_id, position);
```

**position について**：`NUMERIC(12,4)` で fractional indexing を採用。初期値は `1000, 2000, 3000...` など大きな間隔で採番。並び替えは隣接2点の中間値を1行 UPDATE するだけで完結する。小数枯渇時のリバランスは実装タスク。同時に2つの editor が同じ位置へドロップした場合は楽観ロック（UNIQUE違反→クライアント側リトライ）で対処。

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
-- RLS: 本人行のみ読み書き可
```

- ログイン中の editor / admin のみ操作可能（未ログインには★ボタン非表示）
- 同一ストリームの重複ブックマークは PK 制約で防ぐ

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
-- 部分ユニークインデックス：同一 entity + word の pending 申請は1件まで
CREATE UNIQUE INDEX ON entity_word_requests (entity_id, word) WHERE status = 'pending';
```

**承認の二重防止**：承認・却下アクションは `WHERE status = 'pending'` 条件付き UPDATE を使用。影響行数が 0 の場合はエラーを返す。

### 監査証跡の規約
- `*_by` 列（`created_by`, `updated_by`, `added_by`, `requested_by`, `reviewed_by`）には各 Server Action 内で `requireRole()` から得た `user.id` を明示的に書き込む
- service-role 経由の書き込みであっても、認証済みユーザーの ID を明示することで「誰がやったか」を記録する

---

## 4. ページ構成

| パス | 対象 | 内容 |
|------|------|------|
| `/login` | 全員 | メール＋パスワードのログインフォーム。ログイン後は role に応じて `/admin`（admin）または `/member`（editor）へリダイレクト |
| `/member` | editor + admin | プレイリスト管理タブ、エンティティ単語申請タブ |
| `/playlist/[id]` | 公開 | プレイリスト詳細ページ（スティッキープレイヤー＋カードリスト） |
| `/admin`（既存拡張） | admin のみ | 既存機能＋メンバー管理タブ追加、エンティティ申請承認キュー追加 |
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

- テキスト検索：`streams.title`（タイトル）と `streams.summary`（AI要約）を対象に OR 検索。キーワードは両フィールドをまたいでヒットする
- タグ（`topics`）：既存 `streams.topics` カラムを参照
- エンティティ：`entities` テーブルから名前で絞り込み（例：「ドラクエ11」）
- 日付：配信日の範囲指定
- フィルタは AND 条件で組み合わせ可

**ブックマークフィルタ：**

- 「ブックマーク済みのみ表示」に切り替えると自分がブックマークしたストリームだけが検索対象になる
- 公開ページの StreamCard に [★] ボタンを表示（ログイン時のみ）→クリックでブックマーク登録・解除

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
作成：editor名 ／ 2026-06-20

✓ #1  [サムネイル] ドラクエ11 初見①  ─ 2023-04-01 ・ 2.1万再生
▶ #2  [サムネイル] ドラクエ11 初見②  ─ 2023-04-08 ・ 1.8万再生（再生中）
  #3  [サムネイル] ドラクエ11 初見③  ─ 2023-04-15 ・ 1.5万再生
  ...
```

- 既存の `StreamCard` コンポーネントを流用（番号・再生中インジケーター追加）
- YouTube embed は既存の `/stream/[id]` 実装（`youtube.com/embed/${video_id}` iframe）を参照
- プレイリストが存在しない場合は `not-found.tsx` で 404 を返す

**トップページのプレイリストセクション：**
```
プレイリスト
  [サムネイル]             [サムネイル]             [サムネイル]
  ドラクエ11全編           FF7リメイク              ...
  全8本 ・ by editor名     全12本 ・ by editor名
```

---

## 7. 移行方針

### 移行対象の正確な箇所（草薙調査）

「26本」ではなく実態は以下の通り：

- `actions.ts` 内 `requireAdminSession()` 呼び出し：**14箇所**
- ページ DAL 側 `checkAdminSession()` 直呼び：**3箇所**（`admin/entity/page.tsx` 等）
- クライアント hook `useAdminAuth.ts`：**1ファイル廃止**

移行前にこの18箇所リストを確定し、各々の差し替え先を1対1で対応表にすること。

### 段階的切替（ロックアウト防止）

1. Supabase Auth 導入・`user_roles` テーブル作成・`proxy.ts` 新規作成
2. **一幾の admin アカウントを先に作成**してから旧 Cookie 認証の廃止へ進む
3. `requireRole()` ヘルパ新規作成。**並行稼働期間中は旧 Cookie 認証も一時的にフォールバックとして受理するブリッジ**を噛ませ、切替中に管理画面が半壊しないようにする
4. 既存の `requireAdminSession()` / `checkAdminSession()` を `requireRole('admin')` に**ページ単位**で切替（関数1本ずつではなくページ単位で一括切替することで、半端な状態を避ける）
5. 全ページの切替完了＋動作確認後、1〜2週間様子見してから `ADMIN_PASSWORD` env var を削除
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

### 拡張する引数

既存引数に以下を追加：

- `filter_entity_id UUID DEFAULT NULL`：エンティティ名でのフィルタ（`stream_entities` 中間テーブル経由 JOIN）
- `bookmark_user_id UUID DEFAULT NULL`：指定ユーザーのブックマーク済みのみ返す

### テキスト検索範囲の拡張

既存のタイトル検索に `streams.summary`（AI要約）を OR 追加する。

```sql
-- 既存: title ILIKE query
-- 変更後: title ILIKE query OR summary ILIKE query
```

これにより検索系統は anon用RPC（拡張版）1本に統一される。admin/member ともにこの RPC を呼ぶ。

---

## 9. UX 仕様（確定）

### オートセーブ

- 追加・削除・並び替えの操作が完了するたびに**即時自動保存**
- 編集画面の上部に常時「✓ 保存済み」「● 保存中…」を表示
- セッション切れで保存失敗した場合は「⚠ 保存失敗 — ログインし直してください」を表示

### モバイル対応

- D&D はデスクトップ専用。モバイルでは各エピソード行に **↑ / ↓ ボタン**を表示する
- スティッキープレイヤーはモバイルでスクロール時に縮小表示（shrink on scroll）
- タブのタップ領域は最低 44px 確保

### ブックマーク表示制御

- [★] ボタンは**ログイン中の editor / admin のみ表示**。未ログインには非表示

### 最終エピソード後の処理

- YouTube iframe に `rel=0` パラメータを付与し、再生終了後の関連動画表示をオフ
- 最終エピソード再生終了後に「このプレイリストはここまでです」メッセージをオーバーレイ表示

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

## 11. 実装担当（案）

| 担当 | 内容 |
|------|------|
| borma | DBスキーマ（migration SQL）・RLS ポリシー・`search_streams` RPC 拡張 |
| ishikawa | 認可レイヤ（`requireRole`・`verifySession`・`proxy.ts`）・Server Actions・移行ブリッジ |
| paz | `/member`・`/playlist/[id]`・トップページ プレイリストセクション・オートセーブ UI・モバイル対応 |
| togusa | 権限マトリクス全セルの E2E テスト・移行並行稼働テスト・回帰テスト |
