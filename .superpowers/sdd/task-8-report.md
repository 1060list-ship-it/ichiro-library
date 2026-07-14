# Task 8 Report — Server Actions

## 実施内容

1. `apps/web/tests/admin-song-entity-crud.spec.ts` を追加し、Route Aでの新規song/entity作成、3文字未満の`match_names`拒否、`updateSongMetaAction`によるsongメタ更新を統合テスト化した。
2. 実装前に `WATCHPACK_POLLING=true npx playwright test admin-song-entity-crud.spec.ts` を実行し、3件とも未定義のServer Actionを解決できず失敗することを確認した。
3. `apps/web/src/app/admin/actions.ts` に `createSongEntity` と `updateSongMetaAction`、入力型、RPCエラーの日本語マッピングを追加した。
4. fixtureは各テストで `try/finally` を使い、`entities` を削除してから紐づく `songs` を削除するようにした。

## テスト結果

- `WATCHPACK_POLLING=true npx playwright test admin-song-entity-crud.spec.ts` — PASS（3 passed）
- `npx tsc --noEmit` — PASS

## コミット

- `a3bbc24f2e780a0b83d2712cdaaca299cbe4b5a9` — `feat(entity): createSongEntity/updateSongMetaAction Server Actionを追加`

## 自己レビュー

- Server Action入口で両方とも `requireRole(['admin'])` を実行する。
- `songs`/`entities`への直接書き込みを追加せず、`create_song_entity` と `update_song_meta` RPCだけを呼ぶ。
- `song_not_found`、`song_title_required`、`song_already_has_entity`、`slug_already_exists`、`match_names_too_short` の5コードをすべて日本語メッセージへマッピングした。
- 作成・更新成功時は管理画面と公開entity一覧のキャッシュを再検証する。

## 懸念点

なし。
