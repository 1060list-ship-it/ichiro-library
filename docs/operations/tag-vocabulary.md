# tag_vocabulary 運用手順

## `streams.tags` 書き込み経路とガード強度

2026-07-12にリポジトリ全体の`*.ts` / `*.tsx` / `*.py` / `*.sql`を対象として、`streams.tags`を書き換え得る経路を全量調査した。`node_modules`、`.next`、`.git`は生成物のため除外した。

| 経路 | 実装 | ガード強度 | 実際の挙動・裏口確認 |
|---|---|---|---|
| pipeline `upsert_stream()` | `packages/pipeline/batch_runner.py`、`packages/pipeline/whisper_transcribe.py` → `packages/pipeline/store.py` | 新規: **reject** / 既存未レビュー: **drop+log** / 既存レビュー済み: **normalize only** | 新規streamはinactive/unknownを1件でも含めばupsert全体を拒否する。既存未レビューはactive slugへ正規化し、invalid/inactiveをwarning付きで除外する。レビュー済みは正規化後にreview lockで既存tagsへ戻すため、既存値を保持し、新しいAIタグは書かない。 |
| pipeline `reprocess_one()` | `packages/pipeline/reprocess_videos.py` | **drop+log** | 未レビューstreamだけがtags書き込み対象。AI生成tagsをactive slugへ再正規化し、invalid/inactiveをwarning付きで除外して全置換する。レビュー済みは通常スキップ、`--video`強制時もreview lockでtagsをupdate payloadから外すため既存値を保持する。 |
| 管理画面 `updateAdminStream()` | `apps/web/src/app/admin/actions.ts`、`apps/web/src/lib/admin-tag-vocabulary.ts` | **drop+log** | `tags`指定時はフル置換。active slug/labelだけを保存し、inactiveは`admin_tag_update_dropped_inactive_tags`、unknownは`admin_tag_update_dropped_invalid_tags`で記録して除外する。`tags`省略時だけ既存値を保持する。 |
| migration `023_corner_names_backfill` | `supabase/migrations/20260627000002_023_corner_names_backfill.sql` | **unguarded** | 理由: 既に本番適用済みの一回限りの履歴で、`corner_names`と既存`tags`を無検証で直接統合する。アプリから再実行する経路はなく、適用済みmigrationの改変はmigration履歴との不整合を生むため変更しない。対応期限: **2026-07-12完了**（本番全件スキャン0件を確認し、今後のmigrationはactive語彙照合必須とする運用へ固定）。 |
| 開発用seed | `supabase/seed.sql` | **reject** | active語彙を先にseedし、サンプルstreamのtag候補を投入前に照合する。invalid/inactiveが1件でもあれば例外でseedを中止する。本番実行経路ではないが、ローカルDBにもdirty tagsを作らない。 |
| test fixture | `apps/web/tests/admin-update-stream.spec.ts` の`createStreamFixture()` | **reject** | service-role insert前に全tagがactive slugであることを照合し、invalid/inactiveがあればfixture作成を拒否する。旧inactive fixtureの作成・本番相当`streams`への一時混入経路は削除済み。 |

上表の`unguarded`は適用済みmigration履歴1件だけであり、現在の反復可能な書き込み経路には`unguarded`を残していない。service-roleによる任意の手動SQLはアプリケーションガードを迂回できるため、通常運用経路として扱わず、実行時は本番変更の事前承認と実行後の全件スキャンを必須とする。

## create / admin update / reprocess の仕様

| 処理 | 強度 | 既存tags | 新しい入力tags | 保存結果 |
|---|---|---|---|---|
| create（新規stream作成） | **reject** | なし | AI生成値をactive slug/labelと照合 | invalid/inactiveが1件でもあればstream作成全体を拒否。全件validならslugへ正規化して保存。 |
| admin update（管理画面フル置換） | **drop+log** | `tags`指定時は置換対象。省略時のみ保持 | 管理画面の選択値をサーバー側でも再検証 | activeだけを保存。inactive/unknownは除外してそれぞれ`dropped_inactive_tags` / `dropped_invalid_tags`ログを残す。`null`または`[]`は明示クリアとして`NULL`保存。 |
| reprocess（既存stream再処理） | **drop+log** | 未レビューは保持せず全置換 | AI再生成tagsを保存直前に再正規化 | 未レビューはactiveだけで全置換し、invalid/inactiveはwarning付きで落ちる。レビュー済みは通常スキップし、強制実行でもreview lockにより既存tagsをそのまま保持するため、再正規化・削除は行わない。 |

## tagsなし4件の仕様

2026-07-12の本番読み取り確認では全308stream中304件がtags保有、次の4件が`NULL`または空配列だった。

| video_id | 内容 | 状態 |
|---|---|---|
| `p74QXy1k0qU` | THE LAST OF US 2 配信 | v4処理済み・summaryあり・tags空 |
| `N5Bawmg499g` | THE LAST OF US 2 配信 | v4処理済み・summaryあり・tags空 |
| `p2b-v8ZZEBU` | 「山口一郎の遭遇」グッズ紹介 | transcript_failed・summaryなし・tags NULL |
| `29v6v2Z2cM4` | SAKANAQUARIUM 2025 “怪獣” Digest Movie | v4処理済み・summaryあり・tags空 |

**仕様: この4件は「タグ必須」違反ではなく未分類streamとして許容し、後日一括で埋める必須対象にはしない。将来の再処理または管理画面編集でactiveタグが得られた場合だけ通常経路で付与する。**

同日の本番全件スキャン結果は、active語彙25件、invalid tag出現0件、invalid tagを持つstream 0件だった。

## `is_active` 変更時の必須手順

`packages/pipeline/store.py`は`tag_vocabulary`をプロセス内の`_TAG_VOCAB_CACHE`に保持する。TTLやプロセス間共有はないため、`is_active`を変更したら、変更前から稼働している **worker.py / reprocess_videos.py の全プロセスを停止し、再起動する**。再起動完了まで再処理ジョブを実行しない。

cronで15分ごとに起動する通常の`worker.py`は各実行後に終了するが、実行中プロセスがないことを確認する。長時間の`reprocess_videos.py`が動いている場合は、安全に停止できる地点まで待つか、prod_guardの承認手順に従って停止する。本番プロセスの停止・再起動は一幾の事前承認が必要。

## 変更後スモークテスト

1. `tag_vocabulary`で対象slugの`is_active`が意図どおりになっていることを確認する。
2. 管理画面コードを変更した場合は対象Deploymentへ反映されたcommitを確認してから検証する。Production反映は一幾の事前承認を得る。
3. 全worker/reprocessプロセスを再起動し、古い`_TAG_VOCAB_CACHE`を破棄する。
4. 新規stream作成にinactiveまたはunknownを混ぜ、作成全体がrejectされることを確認する。
5. 管理画面フル置換にinactiveまたはunknownを混ぜ、他フィールドは保存され、不正タグだけが落ち、dropログが出ることを確認する。
6. 未レビューstreamを再処理し、既存tagsがAI生成active tagsで全置換されることを確認する。
7. レビュー済みstreamの通常再処理がskipされ、強制再処理でも既存tagsが保持されることを確認する。
8. 全件スキャンでinvalid/inactive tagsが0件であることを確認する。

## 別チケット申し送り

`_TAG_VOCAB_CACHE`のTTL化、明示的reload API、プロセス間共有は今回の対象外。再起動依存をなくす改善タスクは`AI_work/TASKS.md`の「ichiro-library: tag_vocabularyキャッシュの再起動依存を解消」で管理する。
