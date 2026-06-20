# 設計書：招待制メンバー認証＋プレイリスト編集機能

**作成日**: 2026-06-21  
**対象プロジェクト**: ichiro-library  
**ステータス**: 承認済み

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
- **各ページ / Server Action の DAL**：`verifySession()` + `requireRole()` で本当の認可を行う

> ⚠️ Next.js 16.2.4 では `middleware.ts` は deprecated → `proxy.ts` を使用。実装時は `node_modules/next/dist/docs/` を正典とすること。

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

### user_roles テーブル
```sql
CREATE TABLE user_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('editor', 'admin')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT now()
);
-- RLS: 書き込みは service-role のみ。本人行の読み取りのみ許可
```

### playlists テーブル
```sql
CREATE TABLE playlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
-- RLS: 読み取りは全員OK。書き込みは editor + admin のみ
```

### playlist_streams テーブル
```sql
CREATE TABLE playlist_streams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
  stream_id   UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,  -- FK必須
  position    NUMERIC NOT NULL,   -- fractional indexing（小数・大間隔採番）
  added_by    UUID REFERENCES auth.users(id),
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (playlist_id, position)
);
```

**position について**：D&D 並び替え時の制約違反を避けるため `NUMERIC` 型で fractional indexing を採用。初期値は `1000, 2000, 3000...` など大きな間隔で採番。並び替えは隣接2点の中間値を1行 UPDATE するだけで完結する。小数枯渇時のリバランスは実装タスクとする。

**stream_id について**：`streams(id)` UUID への FK を張ることで存在しないストリームの追加を DB レベルで防ぐ。UI での入力は YouTube `video_id`（例：`dQw4w9WgXcQ`）で行い、サーバー側で `streams.video_id` を検索して `streams.id` UUID に変換してから保存する。

### bookmarks テーブル
```sql
CREATE TABLE bookmarks (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_id  UUID REFERENCES streams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, stream_id)
);
-- RLS: 本人行のみ読み書き可
```

- ログイン中の editor / admin のみ操作可能
- 同一ストリームの重複ブックマークは PK 制約で防ぐ

### entity_word_requests テーブル

```sql
CREATE TABLE entity_word_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    UUID REFERENCES entities(id),
  word         TEXT NOT NULL,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES auth.users(id),
  reviewed_by  UUID REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
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
  [タイトルで検索___] [タグ ▼] [エンティティ ▼] [日付 ▼] [検索]
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

### 段階的切替（ロックアウト防止）
1. Supabase Auth 導入・`user_roles` テーブル作成
2. **一幾の admin アカウントを先に作成**してから旧 Cookie 認証の廃止へ進む
3. 共通認可ヘルパ（`requireRole()`）を新規作成
4. 既存 `/admin/actions.ts` の `requireAdminSession()` 呼び出しを `requireRole('admin')` に順次差し替え（一括ではなく関数単位で段階的に）
5. 全アクションの切替完了＋動作確認後、`ADMIN_PASSWORD` env var を削除
6. 旧 `useAdminAuth.ts` / `verifyAdminPassword` を削除

### 最初の admin 作成手順（シード）
```sql
-- Supabase Auth でアカウント作成後、user_roles に手動 INSERT
INSERT INTO user_roles (user_id, role, granted_by)
VALUES ('<一幾のauth.users.id>', 'admin', '<一幾のauth.users.id>');
```

---

## 8. 追加パッケージ

| パッケージ | 用途 |
|-----------|------|
| `@supabase/ssr` | Next.js App Router 対応のサーバーサイド認証 |
| `@dnd-kit/core` | D&D コア |
| `@dnd-kit/sortable` | ソータブルリスト |

---

## 9. 実装担当（案）

| 担当 | 内容 |
|------|------|
| borma | DBスキーマ（migration SQL）・RLS ポリシー |
| ishikawa | 認可レイヤ（`requireRole`・`verifySession`・`proxy.ts`）・Server Actions |
| paz | `/member`・`/playlist/[id]`・トップページ プレイリストセクションの UI |
