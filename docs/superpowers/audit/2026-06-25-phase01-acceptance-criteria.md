# ichiro-library Phase 0/1 合格条件

**作成日**: 2026-06-25  
**対象**: `apps/web/src/proxy.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/app/login/*`, `apps/web/src/app/member/*`, `apps/web/src/app/admin/*`  
**参照**: `docs/superpowers/specs/2026-06-21-member-auth-playlist-design.md` Section 11

## 目的

Phase 0/1 の合格判定を、認証導線・ロール制御・RLS の 3 層で固定する。  
この文書にある項目はすべて `Must` 扱いとし、1件でも未達なら Phase 0/1 は未合格とする。

## リリースゲート

- `proxy.ts` の optimistic redirect と `auth.ts` の本認可が、相互に矛盾せず動くこと。
- `/login` と logout 導線で open redirect やセッション取り残しがないこと。
- `/admin` と `/member` の挙動が、未認証・editor・admin・権限剥奪済みで明確に分かれること。
- anon / revoked user が raw transcript に触れられないこと。
- 合格対象テストに `fixme` / `skip` を残さないこと。

## Phase 0

### P0-01 保護ルートの未認証リダイレクト

- 対象: `GET /member`, `GET /admin`
- 前提: Supabase Auth cookie なし。
- 手順:
  1. `/member` にアクセスする。
  2. `/admin` にアクセスする。
- 合格条件:
  - `/member` は `/login?return=/member` にリダイレクトされる。
  - `/admin` は `/login?return=/admin` にリダイレクトされる。
  - `return` には元の path と query が維持される。
- 確認方法:
  - Playwright で URL 遷移を確認する。
  - 対象テスト: `apps/web/tests/auth/section11-routes.test.ts`

### P0-02 `/login` の認証後遷移

- 対象: `/login`, login action, `sanitizeReturnTo`
- 前提: editor または admin の有効な認証情報を持つ。
- 手順:
  1. `/login?return=/member` からログインする。
  2. 認証済みの状態で `/login?return=/member` を直接開く。
- 合格条件:
  - 未認証からの正常ログイン後は `/member` に遷移する。
  - 認証済みで `/login` に入った場合は `proxy.ts` 側で再ログイン画面を表示せず、sanitize 後の遷移先へ即時リダイレクトされる。
- 確認方法:
  - Playwright で form submit 後の URL を確認する。
  - 対象テスト: `apps/web/tests/auth/login.test.ts`, `apps/web/tests/auth/section11-routes.test.ts`

### P0-03 `/logout` のセッション破棄

- 対象: `logoutAction`
- 前提: editor または admin でログイン済み。
- 手順:
  1. `/member` または `/admin` で logout を実行する。
  2. `/` へ戻ったあと、再度 `/member` と `/admin` にアクセスする。
- 合格条件:
  - logout 実行後に `/` へリダイレクトされる。
  - 直後の `/member` 再訪は `/login?return=/member` に戻される。
  - 直後の `/admin` 再訪は `/login?return=/admin` に戻される。
  - Supabase session cookie が残留せず、保護画面へ戻れない。
- 確認方法:
  - Playwright で logout ボタン押下後の URL と再訪挙動を確認する。
  - 既存根拠: `apps/web/src/lib/auth-actions.ts`, `apps/web/tests/auth/member-access.test.ts`

### P0-04 `return=` の sanitize

- 対象: `apps/web/src/lib/auth.ts`, `apps/web/src/proxy.ts`
- 正常系:
  - `return=/member` はログイン後 `/member` に遷移する。
  - `return=/admin` は認証済み `/login` アクセス時に `/admin` へ戻せる。
- 異常系:
  - `return=https://evil.com`
  - `return=//evil.com`
  - `return=/%0d%0aSet-Cookie:%20session=evil`
  - `return=/\\evil.com`
  - `return=/%5C%5Cevil.com`
- 合格条件:
  - 正常系は指定 path へ遷移する。
  - 異常系は外部 URL や制御文字付き path へ遷移せず、`/` または `proxy.ts` 既定値へフォールバックする。
  - open redirect を作らない。
- 確認方法:
  - Playwright でログイン後の最終 URL を確認する。
  - 対象テスト: `apps/web/tests/auth/login.test.ts`, `apps/web/tests/auth/section11-routes.test.ts`

### P0-05 `proxy.ts` のセッションリフレッシュ

- 対象: `apps/web/src/proxy.ts`
- 前提: refresh token は有効、access token は期限切れ直前または期限切れ。
- 手順:
  1. 期限切れ access token を含む認証 cookie で `/member` か `/admin` にアクセスする。
  2. `proxy.ts` が `supabase.auth.getUser()` を通す。
  3. 同一セッションのまま保護画面や Server Action を続けて叩く。
- 合格条件:
  - `proxy.ts` が更新 cookie をレスポンスへ反映する。
  - リフレッシュ成功時は強制ログアウトされず、後続の `verifySession()` が成功する。
  - リフレッシュ失敗時は保護画面を通さず `/login` へ落とす。
- 確認方法:
  - Playwright か integration test で stale cookie fixture を使い、`Set-Cookie` と後続アクセスの継続性を確認する。
  - 対象実装: `apps/web/src/proxy.ts`

## Phase 1

### P1-01 `/admin` アクセス制御

- 対象: `GET /admin`
- 合格条件:
  - `admin`: 200
  - `editor`: 403
  - `anon`: `/login?return=/admin` へリダイレクト
- 補足:
  - `proxy.ts` はロールを見ないため editor を一度通す。
  - 最終判定は `requireRole(['admin'])` 側で行う。
- 確認方法:
  - Playwright で response status と URL を確認する。
  - 対象テスト: `apps/web/tests/auth/section11-routes.test.ts`

### P1-02 `/member` スタブアクセス制御

- 対象: `GET /member`
- 合格条件:
  - `admin`: 200
  - `editor`: 200
  - `anon`: `/login?return=/member` へリダイレクト
  - 認証成功後は role と email が表示される。
- 確認方法:
  - Playwright で URL と画面表示を確認する。
  - 対象テスト: `apps/web/tests/auth/member-access.test.ts`, `apps/web/tests/auth/section11-routes.test.ts`

### P1-03 権限剥奪済みユーザーの直接呼び出しブロック

- 対象: `user_roles` 行なしだが Supabase Auth session は有効なユーザー。
- 合格条件:
  - `/admin` 直接アクセスは 403 で止まる。
  - `/member` 直接アクセスは member stub を表示せずブロックされる。
  - `requireRole(['admin'])` / `requireRole(['editor', 'admin'])` を通る Server Action は実行できない。
  - `bookmarks` と `entity_word_requests` の直接 SELECT / INSERT は RLS で遮断される。
- 確認方法:
  - service-role で対象ユーザーの `user_roles` 行を削除し、revoked fixture を使って Playwright / integration test を行う。
  - 対象テスト: `apps/web/tests/auth/section11-rls.test.ts`

### P1-04 anon の transcript 非公開

- 対象: `streams.transcript`, `chapters.transcript_segment`, `search_streams`
- 合格条件:
  - anon で `streams.transcript` を直接 SELECT すると `42501` になる。
  - anon で `chapters.transcript_segment` を直接 SELECT すると `42501` になる。
  - anon の `search_streams` RPC は成功するが、返却 payload に `transcript` / `transcript_segment` を含めない。
- 確認方法:
  - Supabase anon client で direct SELECT と RPC を分けて確認する。
  - 参照 migration: `supabase/migrations/20260621074645_014a_fix_column_grants.sql`
  - 既存テスト根拠: `apps/web/tests/auth/rls.test.ts`

## 合格対象テスト一覧

- `apps/web/tests/auth/section11-routes.test.ts`
- `apps/web/tests/auth/login.test.ts`
- `apps/web/tests/auth/member-access.test.ts`
- `apps/web/tests/auth/section11-rls.test.ts`
- `apps/web/tests/auth/rls.test.ts`

## 2026-06-25 時点の未カバー / 未達候補

- `/admin` の `editor -> 403` は `section11-routes.test.ts` で `fixme` のまま。ここが通らない限り P1-01 は未合格。
- `proxy.ts` のセッションリフレッシュは実装済みだが、専用自動テストがまだない。P0-05 は未合格扱いにする。
- anon の direct column access については RPC payload 非露出の確認はあるが、`transcript` / `transcript_segment` 直接 SELECT の自動テストを明示追加した方がよい。
