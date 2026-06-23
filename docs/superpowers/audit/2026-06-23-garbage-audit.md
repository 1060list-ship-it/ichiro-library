# ichiro-library 旧設計ゴミ監査報告書

**実施日**: 2026-06-23  
**対象**: 招待制メンバー認証＋プレイリスト設計（2026-06-21承認）導入後の残骸調査  
**担当**: Claude（バックエンド・DB横断）

---

## サマリー

| 重要度 | 件数 |
|--------|------|
| 🔴 ブロッカー | 4件 |
| 🟡 警告（移行完了後に削除） | 4件 |
| 🟢 軽微 | 1件 |

**最大の問題**: admin画面全体がサーバー側 Supabase Auth 未対応のまま。`requireRole()` は全 Server Action に入っているが、**ページレベルの認証**が旧Cookie（`checkAdminSession()`）か無認証のまま残っている。

---

## 🔴 ブロッカー（実装前に解決必須）

### B-1: `/admin/entity` ページが旧Cookie認証のまま

**ファイル**: `apps/web/src/app/admin/entity/page.tsx:22`

```ts
const authenticated = await checkAdminSession()  // 旧Cookie
if (!authenticated) redirect('/admin')
```

**問題**: Supabase Auth で一幾がログインしても、旧 `ichiro-library-admin` Cookie がない状態では `authenticated = false` となりリダイレクトされる。  
**推奨アクション**: `requireRole(['admin'])` に置き換え。未認証なら `/login?return=/admin/entity` へ。

---

### B-2: `/admin/entity/[id]` ページが旧Cookie認証のまま

**ファイル**: `apps/web/src/app/admin/entity/[id]/page.tsx:12`

```ts
const authenticated = await checkAdminSession()  // 旧Cookie
if (!authenticated) redirect('/admin')
```

**推奨アクション**: B-1 と同様。`requireRole(['admin'])` に差し替え。

---

### B-3: `/admin/stream/[id]` ページが無認証

**ファイル**: `apps/web/src/app/admin/stream/[id]/page.tsx`

```ts
export default async function AdminStreamPage({ params }: PageProps) {
  const { id } = await params
  return <StreamEditorClient videoId={id} />  // 認証ゼロ
}
```

**問題**: Server Action には `requireRole(['admin'])` が入っているが、ページ自体は誰でも表示できる。UI丸見え。  
**推奨アクション**: `requireRole(['admin'])` をページ先頭に追加。未認証は `/login?return=/admin` へ。

---

### B-4: Migration `014` の番号重複

**ファイル**:
- `supabase/migrations/014_member_auth.sql`
- `supabase/migrations/014_songs_singles.sql`

**問題**: Supabase CLI は migration ファイルをタイムスタンプ or 番号でソートして適用する。同じ番号が2つあると適用順序が不定になり、本番DB適用時にどちらか一方が欠落またはエラーになる可能性がある。  
（015〜018 はタイムスタンプ形式 `20260622140345_` で正しい。014 だけ命名規則が古い。）

**推奨アクション**: 2ファイルを以下に改名してタイムスタンプ付与。または番号をずらす。

```
014_member_auth.sql     → 20260621000000_014_member_auth.sql
014_songs_singles.sql   → 20260621000001_014_songs_singles.sql
```

> ⚠️ すでに本番に適用済みかどうかを先に確認すること。適用済みならリネーム不要（ローカル管理の問題）。

---

## 🟡 警告（移行期ブリッジ）

設計書では「旧 Cookie 認証は移行期間中は並行稼働」と明記されている。Supabase Auth への完全移行が確認できたら削除する。

### W-1: `auth.ts` の旧Cookieブリッジコード

**ファイル**: `apps/web/src/lib/auth.ts`

残存している旧コード:
- `getLegacyAdminCookieValue()` (L29-36)
- `hasLegacyAdminSession()` (L42-53)
- `RequireRoleResult` の `isLegacyBridge` 分岐（L17-27, L105-116）

**現状の判断**: 移行期ブリッジとして設計上意図的に残留。ただし `hasLegacyAdminSession()` は admin ページが `checkAdminSession()` を使っている間は機能せず、`requireRole()` 経由でしか機能しない。B-1〜B-3 を修正して admin ページが全て Supabase Auth になったタイミングで削除検討。

---

### W-2: `admin/actions.ts` の旧ログイン関数群

**ファイル**: `apps/web/src/app/admin/actions.ts`

```
L10:  ADMIN_COOKIE_NAME
L145: getAdminPassword()
L155: getAdminCookieValue()
L205: verifyAdminPassword()    ← export / useAdminAuth から呼ばれている
L221: checkAdminSession()      ← export / admin サブページから呼ばれている
L226: clearAdminSession()      ← export / useAdminAuth から呼ばれている
```

**現状の判断**: B-1〜B-3 修正後に、`checkAdminSession` の参照がなくなる。`verifyAdminPassword` / `clearAdminSession` は `useAdminAuth.ts` が残っている限り消せない。W-3 と連動して削除。

---

### W-3: `useAdminAuth.ts` 旧クライアント側認証フック

**ファイル**: `apps/web/src/app/admin/useAdminAuth.ts`（ファイル全体）

`AdminPageClient.tsx:251` と `admin/stream/[id]/StreamEditorClient.tsx:161` が依存中。  
admin ページをサーバー側 `requireRole()` に切り替えれば、クライアント側の「ログイン済みか確認する」責務は不要になる。フック全体削除の対象。

---

### W-4: `proxy.ts` の旧Cookieチェック

**ファイル**: `apps/web/src/proxy.ts`

```ts
L4:  const LEGACY_ADMIN_COOKIE_NAME = 'ichiro-library-admin'
L20: const hasLegacyAdminCookie = request.cookies.has(LEGACY_ADMIN_COOKIE_NAME)
```

L27: `/member` パスへの未認証チェックが `!hasLegacyAdminCookie && !hasSessionCookie` になっているため、旧Cookieでも `/member` に入れる。  
一幾の旧Cookieがブラウザから完全に消えたら `hasLegacyAdminCookie` の参照を削除して `!hasSessionCookie` だけにする。

---

## 🟢 軽微

### M-1: Migration 012 が欠番

`supabase/migrations/` に `012_` が存在しない（001〜011, 013, 014×2, 015〜018）。

handoff ノートでは「012 migration で chapters_anon_read 修正・transcript REVOKE を追加」と書かれていたが、実際にはその内容が `014_member_auth.sql` の Section 1〜2 に含まれている。機能的には問題ない。  
ただし「012が未実装」と誤解される可能性があるため、CONTRIBUTING.md または設計書への補足コメントを推奨。

---

## DB確認結果（borma）

`014_member_auth.sql` には以下が全て含まれており、設計書 Section 3〜5 と照合済み:

| 項目 | 状態 |
|------|------|
| `chapters_anon_read` 修正（USING(true) 廃止） | ✅ 含まれている |
| transcript REVOKE from authenticated | ✅ 含まれている |
| `user_roles` テーブル + RLS | ✅ 含まれている |
| `playlists` テーブル + RLS | ✅ 含まれている |
| `playlist_streams` テーブル + RLS | ✅ 含まれている |
| `bookmarks` テーブル + RLS + user_roles 存在チェック | ✅ 含まれている |
| `entity_word_requests` テーブル + RLS + user_roles 存在チェック | ✅ 含まれている |
| `search_logs` テーブル + admin only RLS | ✅ 含まれている |
| `search_streams` 10引数版に更新 | ✅ 含まれている |

---

## 対応優先順位

```
今すぐ (B-1〜B-4):
  [ishikawa] B-1: admin/entity/page.tsx → requireRole()
  [ishikawa] B-2: admin/entity/[id]/page.tsx → requireRole()
  [ishikawa] B-3: admin/stream/[id]/page.tsx → requireRole()
  [borma]    B-4: Migration 014 重複 → タイムスタンプ命名で解消

Supabase Auth 移行確認後 (W-1〜W-4):
  [ishikawa] W-3 useAdminAuth.ts 削除 → W-2 admin/actions.ts 旧関数削除 → W-1 auth.ts ブリッジ削除 → W-4 proxy.ts 旧Cookieチェック削除
```
