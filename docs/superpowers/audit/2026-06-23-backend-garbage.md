# ichiro-library 旧設計ゴミ調査報告書（バックエンド・認証）

**実施日**: 2026-06-23  
**対象設計**: `docs/superpowers/specs/2026-06-21-member-auth-playlist-design.md`  
**精査対象**: 指定 16 ファイル

---

## サマリー

| 重要度 | 件数 |
|--------|------|
| 🔴 ブロッカー | 3 |
| 🟡 警告 | 3 |
| 🟢 軽微 | 2 |

最大の問題は 3 つだ。

1. `proxy.ts` が新設計どおりのセッション更新をしていない。`/admin` も保護対象に入っていない。  
2. 旧 Cookie ブリッジが `/member` と `/login` にまで漏れていて、導線が壊れている。  
3. `requireRole(['admin'])` の legacy fallback が mutation でも通るため、旧ブリッジ経由の書き込み禁止ルールを満たしていない。  

---

## 指摘事項

### 1. 🔴 ブロッカー

**ファイルパス:行番号**  
`apps/web/src/proxy.ts:18-42`

**問題の内容**  
`proxy.ts` は Cookie 名の有無だけ見て `NextResponse.next()` / redirect を返している。設計書が要求する `supabase.auth.getUser()` によるセッション更新がない。さらに `matcher` が `['/member/:path*', '/login']` のみで、設計上保護対象の `/admin` が含まれていない。  

このままだと:

- access token 更新が走らず、一定時間後に Server Action が `Unauthorized` を返す
- `/admin` が optimistic redirect の対象外のまま残る
- `proxy.ts` が新認証レイヤーの入口として不完全

**推奨アクション**  
修正。`proxy.ts` で Supabase server client を作り、毎リクエスト `auth.getUser()` を実行して Cookie を更新すること。`matcher` は少なくとも `/member/:path*`, `/admin/:path*`, `/login` を含めること。

---

### 2. 🔴 ブロッカー

**ファイルパス:行番号**  
`apps/web/src/proxy.ts:20-35`  
`apps/web/src/app/member/page.tsx:11-18`

**問題の内容**  
`proxy.ts` は `LEGACY_ADMIN_COOKIE_NAME` を持っていれば `/member` と `/login` を通すが、`member/page.tsx` 側の `requireRole(['editor', 'admin'])` は legacy bridge を受理しない。bridge fallback は `rolesAllowed === ['admin']` のときだけ有効だからだ。  

その結果、旧 Cookie だけ持つブラウザでは次の導線が発生する。

1. `/login` へ行く
2. `proxy.ts` が legacy cookie を見て `/member` へ飛ばす
3. `/member` は `requireRole(['editor', 'admin'])` で弾かれ `/login?return=/member` に戻す
4. `proxy.ts` がまた `/member` へ飛ばす

実質ループだ。`LEGACY_ADMIN_COOKIE_NAME` の扱いが広すぎる。

**推奨アクション**  
修正。legacy cookie を許容するなら移行期の `/admin` だけに限定すること。`/member` と `/login` の認証判定からは外す。bridge を完全廃止する段階なら削除でいい。

---

### 3. 🔴 ブロッカー

**ファイルパス:行番号**  
`apps/web/src/lib/auth.ts:95-123`  
`apps/web/src/app/admin/actions.ts:331-368,394-460,516-611,759-795,871-984`

**問題の内容**  
`requireRole(['admin'])` は legacy cookie fallback を返せるが、admin mutation 群は戻り値を受けず `await requireRole(['admin'])` だけで先へ進んでいる。  

代表例:

- `enqueueJob()` `apps/web/src/app/admin/actions.ts:331-368`
- `cancelPipelineJob()` `apps/web/src/app/admin/actions.ts:394-416`
- `deletePipelineJob()` `apps/web/src/app/admin/actions.ts:418-428`
- `clearFinishedJobs()` `apps/web/src/app/admin/actions.ts:430-440`
- `setAdminStreamReviewed()` `apps/web/src/app/admin/actions.ts:442-460`
- `updateAdminStream()` `apps/web/src/app/admin/actions.ts:516-568`
- `saveAdminChapters()` `apps/web/src/app/admin/actions.ts:570-611`
- `upsertAdminEntity()` `apps/web/src/app/admin/actions.ts:759-791`
- `deleteAdminEntity()` `apps/web/src/app/admin/actions.ts:793-799`
- `markStreamReviewed()` `apps/web/src/app/admin/actions.ts:871-982`

設計書では「旧 Cookie ブリッジ経由では書き込み系 Server Action を禁止する」と明記されている。現状は満たしていない。

**推奨アクション**  
修正。mutation では必ず:

```ts
const auth = await requireRole(['admin'])
if (auth.isLegacyBridge) {
  throw new Error('Unauthorized')
}
```

のように明示的に弾くこと。GET 系だけ bridge 許容に分ける。

---

### 4. 🟡 警告

**ファイルパス:行番号**  
`apps/web/src/app/admin/page.tsx:1-4`  
`apps/web/src/app/admin/AdminPageClient.tsx:250-525`  
`apps/web/src/app/admin/useAdminAuth.ts:1-95`

**問題の内容**  
`/admin` は server-first ではない。`page.tsx` は認証せずに `AdminPageClient` を返し、クライアント側で `useAdminAuth()` が旧パスワード入力 UI と sessionStorage を使って認証状態を持っている。  

これは新設計の `requireRole(['admin'])` ベースから外れている。ただし設計書にも「`/admin` と `/admin/stream/[id]` は別工程で server-first 置換」と明記されているので、既知の移行残だ。

**推奨アクション**  
保留つき修正。`/admin` と `/admin/stream/[id]` を server-first に置き換えた後、`useAdminAuth.ts` を削除する。

---

### 5. 🟡 警告

**ファイルパス:行番号**  
`apps/web/src/lib/auth.ts:10,17-41,109-116`  
`apps/web/src/app/admin/actions.ts:10,145-229`

**問題の内容**  
旧 Cookie 認証の残骸はまだ多い。

- `ADMIN_COOKIE_NAME` は `lib/auth.ts` と `admin/actions.ts` に残存
- `getLegacyAdminCookieValue()` は `lib/auth.ts:29-39`
- `hasLegacyAdminSession()` は `lib/auth.ts:41-52`
- `isLegacyBridge` 分岐は `lib/auth.ts:17-27,109-116`
- `verifyAdminPassword()` は `admin/actions.ts:205-219`
- `clearAdminSession()` は `admin/actions.ts:226-229`

移行期ブリッジとして残してよい範囲はある。ただし現在の残り方は `/admin` の client-side 認証と結びついていて、単なる互換レイヤーではなく旧導線そのものが生きている。

**推奨アクション**  
保留。server-first 移行が完了するまでは残す。その後は以下の順で削除する。  
`useAdminAuth.ts` 削除 -> `verifyAdminPassword` / `clearAdminSession` 削除 -> `lib/auth.ts` の legacy bridge 削除 -> `ADMIN_PASSWORD` env 廃止

---

### 6. 🟡 警告

**ファイルパス:行番号**  
`apps/web/src/app/member/page.tsx:42-79`  
`apps/web/src/app/member/MemberPageClient.tsx:3-18`  
`apps/web/src/app/member/actions.ts:6-14`

**問題の内容**  
`/member` の認証自体は server-first で入っている。そこは問題ない。だが実体は「実装中」の土台だけだ。プレイリスト、ブックマーク、エンティティ単語申請の action / UI が存在しない。`member/actions.ts` も logout しかない。  

旧 stub が露出したままという意味では設計変更の残骸だ。

**推奨アクション**  
保留つき修正。stub のまま運用しないなら、playlist/bookmark 系 Server Action 実装まで `/member` の文言を下書き状態に寄せるか、機能実装完了後に差し替える。

---

### 7. 🟢 軽微

**ファイルパス:行番号**  
`apps/web/src/lib/auth.ts:17,54,73,126`

**問題の内容**  
以下は export されているが、現状は外部参照がない。

- `RequireRoleResult`
- `verifySession`
- `getCurrentUserRole`
- `isSafeReturnTo`

内部実装用のまま export が残っている。

**推奨アクション**  
修正。外で使わないなら export を外す。server-first 置換で使う予定があるなら保留でもいい。

---

### 8. 🟢 軽微

**ファイルパス:行番号**  
`apps/web/src/lib/supabase-server.ts:71-75`  
`apps/web/src/proxy.ts:14-16`

**問題の内容**  
`hasSupabaseAuthCookie()` が `supabase-server.ts` で export されているが未使用。`proxy.ts` 側に同等ロジックが重複している。

**推奨アクション**  
修正。どちらかに寄せる。`proxy.ts` を全面修正するならそのタイミングで整理すれば十分だ。

---

## 確認メモ

### login actions

`apps/web/src/app/login/actions.ts:11-34` は旧パスワードログインを混在させていない。`supabase.auth.signInWithPassword()` のみだ。  
`apps/web/src/app/login/page.tsx` と `LoginForm.tsx` にも旧 Cookie 認証の直呼びはない。  

ただし `returnTo` 未指定時の遷移先は常に `/member` なので、設計書の「admin は `/admin`、editor は `/member`」にはまだ未追従だ。

### types.ts

`apps/web/src/lib/types.ts` には旧 Cookie 認証由来の型は見当たらない。  
`Playlist` / `PlaylistStream` / `Bookmark` / `EntityWordRequest` は新設計の先行型定義で、未使用というより「実装待ち」だ。

### scope note

今回の精査対象外だが、旧認証への依存は `apps/web/src/app/admin/stream/[id]/StreamEditorClient.tsx` にも残っている。`useAdminAuth.ts` 削除時は同時に切る必要がある。
