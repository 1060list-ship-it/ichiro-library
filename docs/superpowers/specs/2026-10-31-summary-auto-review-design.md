# 要約の自動校閲（精度改善）設計

- 作成日: 2026-10-31（設計修正のみ。アプリ未実装・SQL未適用）／改訂: 2026-11-01 案A（履歴不明行は保存可・校閲対象外）／2026-11-03 M-5（再保存時の旧active run終端化）／2026-11-04 M-2（INSERT正規入力の例外化）／2026-11-11 M-2（INSERT時のstatus×base整合規則）を反映／2026-11-11 M-2（UPDATE時のstatus×base不一致拒否）を反映／2026-11-11 M-2（RPC入力境界update_summary_review_state・実行テスト節〔第4修正〕）を反映
- 状態: 設計案・正式判定は blocked のまま。将来の実装・migration適用・本番反映は別承認。
- 関連: `docs/operations/summary-check.md`（月次チェック手順）
- 正式チェーン: `chain-ichiro-20261031-summary-auto-review-design-recheck`。
  head: `ichiro-20261031-summary-auto-review-design-recheck`（preflight/initial, blocked）。
  一次情報: `10_system/agent_monitor/sessions/20261031_190604_kana_80120_4491/last_message.md`。
  M-1/M-3/M-4/M-5 resolved（2026-11-03正式）、M-2 open（第2修正済みの解消候補）、N-1 open。全6件のseverity/follow_up/dodは変更しない（statusは正式結果どおり）。
  旧r2はN-1欠落のKRC-F5でabandoned、r3は起動拒否で、いずれも正式結果ではない。
  M-3のstage-deferred案はKRC-F5で撤回済み。本改訂は解消候補であって正式resolvedではない。

## 設計7観点（今回の境界）

| 観点 | 方針 |
|---|---|
| 守るもの | 人手確認済み本文、字幕・根拠の非公開、service_roleのみのRPC |
| 障害分離 | 校閲の停止は当該runに限定。既存の公開可否 `streams.status` は変更しない |
| 回復 | DB runを開始前に永続化。応答喪失は照会し同一runを有限に再開。RPO/RTOの数値保証はしない |
| 変更 | 生成保存・候補抽出・証拠検証・原子確定を分離。新しい分散キューは作らない |
| 確認 | 入力版、attempt CAS、run終端、権限のテスト。今回DB実行はしない |
| 費用 | 初回成功行だけ校閲。再送はLLM再呼出し前に照会。有料基盤採用は別承認 |
| 継続 | 本書・実装計画・未適用037を契約として引継ぐ。履歴不明の旧行は推測しない |

## 1. 目的

要約に混じる誤りを、**一幾が最終チェックする前に自動で減らす**。人間が全文を読む負担を
減らし、仕上がった状態で確認に回す。

### 実際に起きた誤り（2026-10-31の10月点検で実証）

| 種類 | 例 | 原因 |
|---|---|---|
| 固有名詞の崩れ | ゲスト「aiko」→「あ子」 | YouTube自動字幕の誤変換が要約にそのまま入る |
| 根拠のない記述 | BGMなのに「生歌唱」と書く | 要約AIが字幕を読み違える |

**注意（M-1反映）**: 字幕自体も誤変換を含み、字幕の欠落は**存在しないことの証明にならない**。
本設計は「検出を機械的に確証できるものだけを自動で直し、それ以外は人に委ねる」。

## 2. 仕組みの全体像

```
要約生成（現状のまま）
  ↓
【自動校閲モジュール】← 追加する工程（1 review run = 1単位）
  ① 要約と字幕を照合 → 食い違い候補を抽出（LLMは候補出しまで）
  ② 候補ごとに「機械的な根拠」を要求（辞書・公式情報との完全一致）
  ③ 根拠が機械的に成立 → 直す（rule_id・根拠・before/after を記録）
  ④ 根拠が不足／LLMの作話疑い → 直さず needs_review に送る
  ↓
要約完成（一幾は仕上がりを確認）
```

## 3. 自動修正の証拠契約（M-1・resolved）

**LLMの「確実そう」という判断だけで、要約本文を書き換えてはならない。**
LLMの役割は「候補を出す」までとし、修正の可否は機械的な根拠で判定する。

### 3-1. 固有名詞の置換を許す条件（すべて満たす場合のみ）

1. 正しい表記が**辞書（`prompts/entity_catalog.txt` / `song_catalog.txt`）に存在**する、
   または**公式記録（番組公式X等）に取得日時・URL・該当箇所つきで存在**する
2. 誤変換語 → 正しい表記の対応が、字幕スナップショット上の該当箇所と**完全一致**で結び付く
3. 修正対象が固有名詞に限定され、文の言い換え・内容の追加を伴わない

満たさない場合は置換せず `needs_review`。推測で置き換えない。

### 3-2. 根拠のない記述の扱い

事実と矛盾する／根拠がない記述は、削除または**根拠が示す最弱の表現への縮退**に限定
（`[歌声]`不在を「BGM」と断定しない）。断定的な別表現を創作しない。

### 3-3. 記録（自動変更はすべて以下を保存）

`rule_id` / 根拠（字幕snapshot ID＋範囲、またはカタログ版数・公式URL＋取得日時）/
`before_text` / `after_text` / `confidence`（high=機械的根拠あり、low=根拠不足）。
**根拠不足・LLM作話疑いは必ず `needs_review`** になることをテストで固定する。

## 4. 状態と確認解除（M-2の修正案・正式open）

`summary_review_status` は公開ラベル、`summary_review_base_status` はconfirmedを除く未確認状態の保存先。
findingの有無を状態の判定に使わない。`is_reviewed IS TRUE ⇔ summary_review_status='confirmed'`。

| 未確認状態（base） | 意味・公開表示 | 確認→解除（本文不変） |
|---|---|---|
| legacy_unreviewed | 旧対象外・再生成対象外／表示なし | 同じ状態へ戻る |
| pending | 初成功保存済み・校閲未完了／要約確認前 | 同じ状態へ戻る |
| reviewed_no_change | 正常完了、finding **0件でもよい**／要約確認前 | 同じ状態へ戻る |
| auto_fixed | 自動修正済み／要約確認前 | 同じ状態へ戻る |
| needs_review | 根拠不足・入力変更／要約確認前＋要確認箇所 | 同じ状態へ戻る |
| review_failed | 校閲失敗／要約確認前＋校閲要再実行 | 同じ状態へ戻る |
| （公開列のみ）confirmed | 一幾確認済み／印なし | 保存したbaseへ戻る（再校閲は起動しない） |

BEFOREトリガーはOLD/NEWだけを使い、未定義の表や自身の行へのSELECTに依存しない。
boolだけの直接UPDATEはその値を優先し、状態だけのUPDATEはboolを同期。両方変更して矛盾したら拒否。
INSERTの正規入力は一意に定める: `is_reviewed=true` は `summary_review_status='confirmed'` とだけ共起し、
`is_reviewed∈{false,NULL}` はconfirmed以外の6状態とだけ共起する。組み合わせを崩すINSERT
（true＋非confirmed、false・NULL＋confirmed）は例外 `summary_review: contradictory_confirmation_insert` で拒否し、
黙って正規化しない（M-2・2026-11-04改訂）。
非confirmed行のINSERTは `summary_review_status = summary_review_base_status` の一致ペアを必須とする
（M-2・2026-11-11改訂）。食い違い（status=`legacy_unreviewed`＋base=`pending`／その逆方向）は
例外 `summary_review: contradictory_status_base_insert` で拒否する。base省略は列defaultの
`legacy_unreviewed` と比較され、非legacyの非confirmed statusとの組み合わせは拒否する。
INSERT時のbase正本による黙示同期はしない（UPDATE分岐の矛盾拒否と対称）。旧のstatusからbaseへの黙示代入は廃止。
confirmed行のbaseは6状態の保存値（確認解除時の復元先）として保持し、INSERT時に変更しない。

UPDATEでは、非confirmed行の status と base の両方を明示変更（両列ともNEW≠OLD）した結果が
不一致になる場合（status=`pending`＋base=`review_failed`／その逆方向）は例外
`summary_review: contradictory_status_base_update` で拒否し、黙って同期しない（M-2・2026-11-11改訂2）。
一致ペアへの同時変更は通過する。statusのみの変更は公開ラベル更新としてbaseへ自動同期し、
baseのみの変更は実状態の直接更新として公開ラベルが追従する（従来どおりの単独更新）。
confirmedへの遷移でbaseを同時に指定した場合は復元先の保存として許す。

### 2層契約と4経路の一貫性（2026-11-11 第4修正）

- **層1＝状態契約**: triggerが全経路共通の正本。非confirmed行の正規状態は常に
  `summary_review_status = summary_review_base_status`。両変更の観測不一致は
  `summary_review: contradictory_status_base_update` で拒否する。単独変更は上記の同期規則に従う。
- **層2＝入力契約**: `update_summary_review_state(p_stream_id uuid, p_expected_version bigint,
  p_is_reviewed boolean, p_status text, p_base text) → void`（service_role限定）は両値を明示パラメータで受け、
  非confirmedでは一致ペアを必須とする。旧値同値の明示指定を含む不一致は両方向とも、
  confirmed指定で `p_status <> 'confirmed'` の場合と同じ
  `summary_review: contradictory_status_base_update` で書込み前に拒否する。
  baseは常に未確認6状態、statusは非confirmed時その6状態・confirmed時はconfirmedのみ。
  不存在は `summary_review: stream_not_found`、NULL状態パラメータ（版NULLも含む）は
  `summary_review: state_params_required`、版不一致は `summary_review: version_conflict`、
  状態の定義域外は `summary_review: invalid_state`。NULL正規化はしない。
  行ロック後に版照合しstateの3列だけをUPDATEする。本文/字幕は不変、既存triggerも走る。
  expected_versionは時点ガードであり、状態ラベルのみの変更は版不変。確認boolの変更は既存規則で版が増える。

**直接UPDATEの構造的限界（D3承認）**:
直接UPDATEは状態を指定する界面であり、意図（明示指定）を指定する界面ではない。`SET col = 同値` は `NEW = OLD` となり未指定と区別できない（SQL仕様・PostgreSQL公式DocsのUPDATE OFはSET句ベースという記述と合わせて明記）。明示指定レベルの検証が必要な操作は `update_summary_review_state` RPCを使う。

ここでの「同値SET=no-op」はOLD/NEWによる状態契約上の定義であり、UPDATE文自体や他のtriggerが
実行されないという意味ではない。[PostgreSQL公式Docs CREATE TRIGGER / Notes](https://www.postgresql.org/docs/18/sql-createtrigger.html#SQL-CREATETRIGGER-NOTES)
は `UPDATE OF` をSET句ベースと定義し、`SET x = x` でも列指定triggerが発火すると明記している。
本triggerは `UPDATE OF` によるSET句の列指定検出を行わず、OLD/NEWのみで状態変化を判定する。

| 経路 | 境界・整合規則 | 矛盾ペアの扱い |
|---|---|---|
| INSERT | 行リテラルで非confirmedの一致ペア必須 | 両方向とも `summary_review: contradictory_status_base_insert`。confirmed＋base6状態は保持 |
| UPDATE直接 | 状態界面。単独変更は同期、同値SETは状態契約上no-op | 両変更の観測不一致は `summary_review: contradictory_status_base_update`。明示指定の検証はRPCを使う |
| RPC | 両値明示パラメータで非confirmedの一致ペアを強制 | 旧値同値の明示指定も含め両方向とも `summary_review: contradictory_status_base_update` |
| backfill | trigger生成前に非confirmedはstatus=base=legacy_unreviewedを生成 | 整合ペアを構造的に生成し、CHECK・同梱テストでも確認 |

037末尾の `M-2 EXECUTION TESTS` DO節は適用時に自動実行し、失敗はRAISEでmigrationを失敗させる。
INSERT両方向・一致6状態・confirmed/base保持、直接UPDATE両方向・一致ペア・単独同期・確認/解除・
同値SETの両方向・ABA/版単調、新RPCの旧値同値指定両方向・一致6状態・版/NULL/定義域外拒否・
confirmed/解除、backfill整合・CHECK存在・RLS有効化・RPCの実効ACLを検査する。
各fixtureはネストBEGIN/EXCEPTIONで成功時もrollbackする。今回はSQL未適用で、実行結果の実測ではない。

NULL boolはfalseへ正規化しNOT NULL＋CHECKで同値を担保。詳細編集・一覧・解除・pipelineにも同じ規則。
本文/字幕の直接変更は（legacy以外の）baseをneeds_reviewへ失効させ、確認中なら公開列はconfirmedを維持。
確認/解除・本文・字幕の変更で `summary_review_version` を単調増加させる。同じ本文へ戻すABAも検出する。
base/版は非公開。管理者の本文編集は許すが、自動生成保存と校閲RPCは確認済みなら本文を変更しない。

## 5. 初回成功と共通保存境界（M-3の修正案・正式resolved）

### 5-1. 現行と変更予定を分ける

- `store.py:143-209` の現行戻り値は **(stream_id, is_review_locked) の2値のみ**。
  行の有無・status・ai_result非Noneは、過去成功の判定にならない。
- `batch_runner.py:73-79`、`whisper_transcribe.py:214-220` はupsert_stream経由。
- `reprocess_videos.py` は実体が **reprocess_one()**。`process_stream()`という関数名ではなく、
  469-488行の直接streams.updateが保存境界。ここも共通保存へ置き換える。
- `summarize.py:271-280` のキー存在検査だけでは非空本文を保証しない。

### 5-2. 単調マーカーと原子的判定

成功は「生成結果がdictかつsummaryが文字列で非空白、DBへの本文保存が確定したこと」。
Pythonではstrip、SQLではPOSIX空白クラスによる非空検査を行い、空/NULL/失敗は成功マーカーを動かさない。
`summary_success_seen` は新規false→初成功trueの単調マーカー。statusがsummary_failedへ戻ってもtrueのまま。

**旧履歴の限界と案Aの確定（一幖承認・2026-11-01）**: migration時、非空本文が残る旧行はtrueとして対象外。
本文が空の旧行は過去成功後に消された可能性を現行列だけでは排除できず、NULL（履歴不明）とする。
NULLをfalseともtrueとも推測しない。保存RPCは履歴不明でも**非空本文の保存を受け付ける**（案A: 生成・保存は現状運用を維持）。
校閲runは作らず、baseはlegacy_unreviewedのまま人手確認へ回す。NULLはNULLのまま維持し、単調制約
（NULL→NOT NULL遷移の拒否）により後からtrue化して校閲対象へ入ることもない。
履歴監査によるtrue/falseの確定は案A採用により必須ではなく、将来の別作業とする。
新規false行の初回失敗→成功は全経路で校閲対象。

新共通境界は `save_generated_summary(p_stream_id uuid, p_expected_version bigint, p_summary_text text, p_review_run_id uuid) → jsonb`。
メタデータupsert/直接updateからsummaryとis_reviewedの古い読取値の書戻しを除外し、**本文はこのRPCだけで保存**。
全呼出元で現在版を取得し、DB内でstream行ロック→版照合→非空本文保存→falseならtrue化＋pending＋run INSERTを原子的に行う。
同時初成功の敗者は版競合、再読取後はtrueなので再生成扱い。runはUNIQUE(stream_id,input_version)で二重作成不可。
戻り値は `{stream_id,is_review_locked,was_first_summary_success,review_run_id,version}`。
`was_first_summary_success` は今回新たにrunを作った時だけtrue。保存応答喪失時はrun_idを照会し、既存なら同じrunを回収する。
upsert_streamの将来戻り値もこの構造へ明示変更し、batch/whisperの2値unpackを同時改修する。現行に実装済みとはしない。
再生成は本文を保存してもrunを作らずbase=legacy_unreviewed。確認済みはlocked=trueで保存せず、runなし。
履歴不明（NULL）も同じ扱いで、本文を保存しても校閲runを作らない（案A）。
再保存（非first）は当該streamの未終端run（pending/running/failed）を本文保存と**同一トランザクションで stale へ終端化**し、
終端理由（`superseded_by_resave`・版）をresult_payloadへ記録する（M-5・2026-11-03改訂）。runを孤児にせず、
旧workerの後続commitは終端payload不一致として拒否される。失敗/空本文の保存では既存runを終端化しない
（保存されない本文に対するrunのため）。未claim（attempt NULL）のpending runも終端化できるよう、
run表のCHECKは stale の attempt_id を必須としない（succeeded/failedは必須のまま）。
tags等のメタデータ・章の保存はこの校閲トランザクション外。既存の確認ロックは維持し、古いsummaryを書き戻さない。

| 到達経路 | 成功歴false＋非空成功 | true（昔成功→再生成失敗後も） | NULL旧履歴不明 |
|---|---|---|---|
| 通常取り込み | 初成功runを作る | 校閲しない | 保存可・runなし（人手確認） |
| batch_runner --video | 初成功runを作る | 校閲しない | 同左 |
| reprocess_videos.reprocess_one | 初成功runを作る | 校閲しない | 同左 |
| whisper（要約あり） | 初成功runを作る | 校閲しない | 同左 |
| whisper --no-summarize | 保存RPCも校閲も呼ばない | 同左 | 呼ばない（案Aの影響なし） |

失敗/空本文なら全経路でrunなし、マーカー不変。reprocessの通常抽出は現在summary_failedを除外するが、
「ジョブに選ばれるか」と「到達行が校閲適格か」は別。選定条件・自動リトライ改善は本件で変更しない。

## 6. 永続run・原子確定（M-4維持／M-5修正案・正式resolved）

### 6-1. 最小の永続単位と権限

`summary_review_runs`: run_id PK、stream_id、input_version、input_summary、input_transcript、
state（pending/running/succeeded/failed/stale）、attempt_id、result_payload、開始/終端時刻。
finding **0件でもrunは必ず存在**。`summary_review_log` は `(run_id,finding_no)` PK＋run/stream複合FK。
同じruleを複数箇所へ適用できる。ログのevidence/before/after/confidenceは§3契約を維持する。
stale の attempt_id は任意（未claimのまま再保存で無効化されたrunはNULL。claim後に無効化されたrunは旧attemptのまま・M-5）。

run/logはRLS＋PUBLIC/anon/authenticatedの全権限を剥奪。service_roleもSELECTのみ、書込みはRPC所有者経由。
公開は既存026の列権限を維持してsummary_review_statusだけSELECT追加。base/版/マーカー/入力/根拠は公開しない。
詳細は既存の管理者認可を通すServer Actionのみ。SECURITY DEFINERはsearch_path=pg_catalog、全オブジェクトをpublic修飾。
全関数のPUBLIC/anon/authenticated EXECUTEを剥奪、呼出用3RPCだけservice_roleへ付与。

### 6-2. RPC契約（いずれも未実装・037ドラフト）

| 関数 | 引数（型・順序） | jsonb戻り値 |
|---|---|---|
| save_generated_summary | p_stream_id uuid, p_expected_version bigint, p_summary_text text, p_review_run_id uuid | §5の5キー |
| claim_summary_review_run | p_review_run_id uuid, p_stream_id uuid, p_attempt_id uuid, p_previous_attempt_id uuid | {state,claimed,attempt_id} |
| commit_summary_review_run | p_review_run_id uuid, p_stream_id uuid, p_attempt_id uuid, p_findings jsonb, p_summary_text text, p_new_status text | {state,replayed} |

ロック順は常に **streams→当該run**。別streamに同じrun_idは拒否。生成保存は既存run_idなら入力本文/保存前版の一致を検査し、再保存しない。
claimはpending＋previous=NULLで一度だけrunningへ。attempt_idは呼出側UUID、同じattemptの再送はclaimed=false（新規実行の許可ではない）。
復旧claimはfailed/runningの旧attempt一致CASで新attemptへ交換。元workerの停止を運用で確認した場合のみ行い、旧attemptのcommitを拒否。
failedの再開も同じrun・同じ入力版だけ。succeeded/staleは再開不可。

commitはrunの入力版・本文・字幕と現在行を照合し、確認済み又は変更済みならrunだけstaleに終端し、本文/公開状態/base/logを触らない。
成功時は本文・finding・run終端・base/公開ラベルを同一トランザクションで確定。streams.status（public/unlisted等）は変更しない。
`reviewed_no_change` は入力本文のまま・finding=[]。`review_failed` は本文不変・finding=[]・run=failed。
`auto_fixed` は変更あり＋highの変更根拠あり＋lowなし。`needs_review` はlow候補あり、low候補自体は変更不可。
機械検証器（§3）を通った修正だけがDBへ到達する。SQLの構造検査は根拠の真実性の証明ではない。
同一attemptの終端再送は保存したjsonb（本文/status/findings配列の順序を含む）と完全一致ならreplayed=true、DB更新なし。
改変再送は拒否。後から手動確認/編集した行への古い成功再送もno-opで、再上書き/状態巻戻しをしない。
SQL例外は全体rollback。ログON CONFLICTだけで本文の冪等性を主張しない。

## 7. 失敗と有限の回復手順（M-5）

| 局面 | DB状態と処置 |
|---|---|
| 保存/claim前からDB不能 | 校閲を開始しない。DB成功/失敗状態は未確定。復旧後run_idを照会 |
| 初成功保存後にプロセス停止 | pending runが開始前記録。入力snapshotで同一runをclaim |
| 公式取得不能 | 候補未検出と区別。該当箇所を変えずlow finding＋needs_review |
| LLM/検証器失敗、DB接続可 | 同じattemptでreview_failed（本文不変・空finding）をcommit |
| commit失敗/応答喪失、DB不能 | review_failedを確実に書けるとはしない。DB状態未確定として停止 |
| 復旧後の照会 | service_roleでrun_id/stream_idを照会。succeededは保存結果を採用、staleは終了。pendingは初claim |
| running/failedの復旧 | 元worker停止確認→旧attempt CASで同一runを再claim→版不変なら再計算/commit。不一致はstale |

runがない場合のみ同じ保存前版・run_idで保存を再送（生成本文が失われた場合は再生成前に行/マーカーを照会）。
同根因の単純な再試行は1回まで、その後はrunを残して主担当へ停止報告。無期限自動再試行・新分散キュー・ローカル開始台帳は作らない。

## 8. 公式情報の照合元

番組公式X（取得日時・URL・該当箇所を記録）／楽曲カタログ（版数を記録）／人物カタログ（版数を記録）。
取れない場合は推測で埋めず `needs_review`。

## 9. 効果判定（N-1・open / nice-to-have / fire-and-forget）

新規20〜30件で、自動修正の正解率・見逃し率・不要 `needs_review` 率・校閲不能率を記録してから
過去分への拡大を判断。数値閾値は未決。今回勝手に確定せず、N-1のstatusも変えない。

## 10. 着手前に必要な判断（一幾）

1. **DBスキーマ・共通保存/claim/commit契約変更の承認**（037は未適用）
2. 旧空本文行の扱い — **確定（2026-11-01 一幖承認・案A）**: 履歴不明行は生成・保存を現状運用どおり維持し、校閲だけ対象外として人手確認へ。履歴監査によるtrue/false確定は必須でなく、将来の別作業
3. 表示デザインの確定（「要約確認前」は仮確定）

## 11. 非対象

- 要約生成そのものの精度改善（プロンプト改良）
- 字幕の誤変換の根本対策
- 過去成功済み要約の再生成への校閲、ジョブ選定条件の変更（拡大は§9の後、別判断）
