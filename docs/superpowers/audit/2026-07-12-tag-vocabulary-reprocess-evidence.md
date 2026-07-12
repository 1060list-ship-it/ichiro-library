# tag_vocabulary 混入3件の個別再処理証跡

実行日時: 2026-07-12 11:10–11:12 JST

## 承認と対象

一幾の明示的なGOを受け、本番Supabase DB更新およびGemini API課金を伴う`--video`個別再処理を実行した。

- `9G_G2IEmEkI`
- `4FvH_zZ4QzM`
- `ld-6DYFuL68`

## 実行前確認

- Pythonプロセスの実引数を照合し、`worker.py` / `reprocess_videos.py`稼働プロセスは0件。
- `tag_vocabulary.is_active=true`は25件。
- `casual_talk` / `fan_interaction` / `relationships`はすべて`is_active=false`。
- 3件すべての既存`tags`に`relationships`が含まれていた。
- `reprocess_videos.py`の直接update経路が`normalize_tags()`を通っていないバイパスを発見し、active語彙正規化を追加。
- 回帰テスト23件PASS後に本番実行へ進んだ。
- 各動画は別々の新規Pythonプロセスで実行し、プロセス内`_TAG_VOCAB_CACHE`を毎回新規ロードした。

## 実行結果

| video_id | 更新時刻 (UTC) | 保存tags | relationships | 語彙外 | chapters |
|---|---|---|---:|---:|---:|
| `9G_G2IEmEkI` | 2026-07-12 02:11:11.664804 | `guest`, `love_advice`, `music_production`, `mental_health`, `festival` | なし | なし | 6 |
| `4FvH_zZ4QzM` | 2026-07-12 02:11:52.526223 | `gaming` | なし | なし | 5 |
| `ld-6DYFuL68` | 2026-07-12 02:12:41.785780 | `gaming`, `philosophy` | なし | なし | 3 |

最終クエリ結果:

- `VERIFY_ACTIVE_COUNT=25`
- `TARGET_RELATIONSHIPS_COUNT=0`
- `ALL_TARGETS_VALID=true`
- 全3件とも`ai_model=gemini-2.5-flash`、`ai_prompt_ver=v4`、`status=public`

`ld-6DYFuL68`はGeminiが4章を生成したが、1章が既存の時刻スナップ品質ガードでdropされ、3章を保存した。タグ更新は正常完了した。

## Gemini usageとコスト

Gemini 2.5 Flash Standardの公式単価（100万tokens当たり入力$0.30、cached input $0.03、出力・thinking込み$2.50）で算出。

| video_id | prompt | cached | candidate | thinking |
|---|---:|---:|---:|---:|
| `9G_G2IEmEkI` | 72,181 | 3,071 | 1,570 | 4,938 |
| `4FvH_zZ4QzM` | 31,490 | 3,069 | 1,230 | 5,564 |
| `ld-6DYFuL68` | 23,603 | 3,069 | 1,118 | 7,047 |
| 合計 | 127,274 | 9,209 | 3,918 | 17,549 |

- 非cached入力: 118,065 tokens × $0.30 / 1M = $0.0354195
- cached入力: 9,209 tokens × $0.03 / 1M = $0.00027627
- 出力（candidate + thinking）: 21,467 tokens × $2.50 / 1M = $0.0536675
- 合計概算: **$0.08936327**（$1=160円換算で約14.3円）

実行前概算は$0.043–$0.093（約7–15円）で、実測概算は範囲内。請求確定額はGoogle側の請求明細を正本とする。

## 実行後テスト

- pipelineテスト: 40件PASS
- `git diff --check`: PASS
