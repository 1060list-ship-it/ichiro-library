# tag_vocabulary 非activeタグ混入の原因切り分け

## 対象

- `9G_G2IEmEkI`: `updated_at=2026-07-04 10:30:16 UTC`
- `4FvH_zZ4QzM`: `updated_at=2026-07-09 15:05:39 UTC`
- `ld-6DYFuL68`: `updated_at=2026-07-09 15:06:26 UTC`
- 3件とも `ai_prompt_ver=v4`、`is_reviewed=false`、tagsに `relationships` が残存

## 時系列と確認結果

1. migration 028 のリモート適用バージョンは `20260704004801`。migration名と適用記録から適用時刻は `2026-07-04 00:48:01 UTC`。同migrationで `casual_talk` / `fan_interaction` / `relationships` が `is_active=false` になり、現在の実DBでも3件ともfalseを確認した。
2. 3 streamsの更新はmigration適用後。それぞれ約9時間42分後、約5日14時間17分後に当たる。
3. `/private/tmp/ichiro-worker.log` を3 video_idで検索した結果、記録されたpipeline更新は2026-06-22の旧処理だけで、上記updated_at付近にv4再処理の記録はなかった。
4. 該当時刻（JSTでは2026-07-04 19:30、2026-07-10 00:05〜00:06）を確認した。7/4 19:30のcron workerは `pending job not found` で終了している。7/10 00:00も同様で、3件を処理したログはない。
5. 実DBの `pipeline_jobs` をmigration適用から2026-07-10 02:00 UTCまで確認したが、該当ジョブは0件だった。
6. 通常workerはcronから15分ごとに起動し、1回のポーリングとstatus更新後に終了する。migration前から7/9まで同一Pythonプロセスが生存して `_TAG_VOCAB_CACHE` を保持する構造ではない。
7. v4一括再処理開始コミットは2026-07-04 18:23 JSTでmigration適用後。migration前に読み込んだキャッシュを保持したまま開始したv4プロセス、という時系列とも一致しない。

## 結論

AIパイプラインの古い `_TAG_VOCAB_CACHE` が原因である可能性は、プロセス寿命・ジョブ履歴・workerログ・時系列から棄却できる。最有力は、当時vocab検証がなかった `updateAdminStream()` を使う管理画面編集、または同等の直接手動更新。

更新主体を記録するDB監査列・監査ログがないため、「管理画面」対「直接手動DB更新」の完全な一意特定はできない。ただし、少なくとも通常worker/pipeline_jobs経由の混入を示す証拠はなく、管理系の書き込み経路にサーバー側ガードが必要という実装判断は変わらない。
