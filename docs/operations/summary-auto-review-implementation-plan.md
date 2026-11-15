# 要約の自動校閲 実装計画

- 作成日: 2026-10-31（初回成功・永続run契約の設計修正）／改訂: 2026-11-01 案A（履歴不明行は保存可・校閲対象外）／2026-11-03 M-5（再保存時の旧active run終端化）／2026-11-04 M-2（INSERT正規入力の例外化）／2026-11-11 M-2（INSERT時のstatus×base整合規則）を反映／2026-11-11 M-2（UPDATE時のstatus×base不一致拒否）を反映
- 状態: 設計案のみ。アプリ未実装・SQL未適用。正式blockedを変更しない。
-- 2026-11-11 改訂3: M-2（update_summary_review_state RPC・実行テスト節）を反映。
- 設計の正本: `docs/superpowers/specs/2026-10-31-summary-auto-review-design.md`
- migration案: `supabase/migrations/20261031000000_037_summary_review_status.sql`（適用承認待ち）
- 正式チェーン: `chain-ichiro-20261031-summary-auto-review-design-recheck`。
  head `ichiro-20261031-summary-auto-review-design-recheck`、preflight/initial, blocked。
  証跡: `10_system/agent_monitor/sessions/20261031_190604_kana_80120_4491/last_message.md`。
  旧r2はN-1欠落KRC-F5でabandoned、r3は起動拒否。正式結果ではない。stage-deferred案は撤回済み。

## 確定した方針（一幾承認・2026-10-31）

1. 生成直後に自動で校閲を走らせる
2. 確実な間違いだけ直し、曖昧なものは印をつけて残す（推測で置き換えない）
3. 字幕＋公式情報の両方で照合する
4. 一幾の確認前には「要約確認前」の印を出す
5. **初めて非空の要約生成・保存に成功した行だけ**。処理経路は問わない。過去成功済みの再生成は対象外。
6. 履歴不明の旧行（旧空本文）は校閲対象外。生成・保存は現状運用どおり維持し、人手確認へ（案A・一幖承認 2026-11-01）。

## 正式finding全6件（修正案であって判定更新ではない）

| ID | 指摘 | 対応（設計書の該当節） |
|---|---|---|
| M-1 | 自動修正の証拠契約が足りない。LLMの判断だけで書き換えると校閲が新たな誤りを作る | §3 証拠契約。LLMは候補出しまで。機械的根拠が成立した時だけ修正。根拠・before/after・rule_id を必須記録。根拠不足は必ず needs_review |
| M-2 | open：0 findingの正常完了がlegacyへ誤分類 | §4 未確認状態baseを保存、確認解除はそのまま復元。NULL正規化＋直接UPDATEの同期＋版による確認済み保護。INSERT正規入力の一意定義・矛盾INSERT拒否（2026-11-04）。INSERT時のstatus×base整合規則・矛盾INSERT例外化（2026-11-11）。UPDATE時のstatus×base不一致拒否・矛盾UPDATE例外化（2026-11-11改訂2）。第4修正＝状態契約＋RPC入力契約の2層、4経路一貫表、直接UPDATEは同値SET=no-opとして定義。update_summary_review_stateで旧値同値の明示指定も両方向拒否、migration同梱DOテスト（適用時自動実行・RAISE失敗でmigration失敗） |
| M-3 | 経路別例外と初回成功定義の矛盾 | §5 非空本文＋単調成功歴＋行ロック保存。再処理の直接UPDATEも共通RPCへ。空本文の旧行は履歴不明＝保存可・校閲対象外（案A） |
| M-4 | migrationのRLSと公開表示の権限が矛盾（PUBLIC向けポリシー・状態列に閲覧権限無し） | §6 RLSを service_role 限定に。anon/authenticated/PUBLIC を明示剥奪。公開は状態列のみ。詳細ログは管理者限定 |
| M-5 | run 0件/応答喪失/再送で整合しない | §6/§7 初成功保存時に永続run、attempt CAS、版照合、終端payload比較、原子commit、DB不能時は未確定として復旧照会。再保存時の旧active run同一tx終端化＋stale attempt任意化（2026-11-03） |
| N-1 | open：nice-to-have / fire-and-forget | §9 新規20〜30件の測定。拡大閾値は未決のまま。今回reround対象へ変更しない |

M-1/M-3/M-4/M-5は正式resolved（2026-11-03）。M-2はopen（第2修正済みの解消候補・2026-11-11）。M-1〜M-5はmust-fix/recheck-required、各dodは一次情報のまま不変。

## 作るもの

### A. 校閲モジュール（新規） `packages/pipeline/summary_review.py`

初成功保存と同じDBトランザクションでrunを作る（0 findingでも永続）。外部取得・LLM実行はclaim確定後のみ。

処理の流れ（§3 証拠契約に厳密に従う）:
1. 要約と字幕を照合し、食い違い候補を抽出（**LLMは候補出しまで**）
2. 候補ごとに機械的根拠を要求（辞書・公式情報との完全一致、取得日時・URL・該当箇所）
3. 根拠が機械的に成立 → 直す（`rule_id`・根拠・before/after を `summary_review_log` に記録・confidence=high）
4. 根拠が不足／LLM作話疑い → **直さず** needs_review（confidence=low）
5. attempt/入力版を指定しcommit RPCへ渡す（本文・ログ・run終端・base/公開ラベルを原子的に確定）。
   before/afterは順次完全一致置換で最終本文を再構成できること。全出現箇所の根拠を検証器で確認する。

### B. 全経路を共通保存へ（将来の実装・今回は変更しない）

- 現行 `upsert_stream` の戻り値は `(stream_id,is_review_locked)` の**2値**。
  将来は `{stream_id,is_review_locked,was_first_summary_success,review_run_id,version}` に明示変更する。
- メタデータupsertからsummaryと読取時点のis_reviewed書戻しを外し、非空生成本文は共通save RPCにのみ渡す。
  Pythonの成功判定はdict＋文字列summary＋strip非空。失敗/空は既存本文・成功歴を消さない。
- `batch_runner.process_video`（通常/--video）と `whisper_transcribe.transcribe_and_store` の2値unpackを変更。
- `reprocess_videos.reprocess_one:469-488` はupsert_streamを呼ばない。ここでsummaryを直接UPDATEせず同じ保存ヘルパーを使う。
  読取済みrowのstatusやis_reviewedだけで判定しない。`process_stream()`という実関数は今回の対象コードにはない。
- 成功歴false→非空保存だけが新run作成。trueは再生成なのでrunを作らず、既存のactive run（pending/running/failed）があれば同一txでstaleへ終端化（M-5・2026-11-03）。確認済みはlockedで本文変更なし。
  NULL旧履歴不明は保存可・校閲対象外（案A・一幖承認 2026-11-01）。runを作らずbase=legacy_unreviewedのまま人手確認へ。
  旧行をstatus=summary_failedだけでfalseへ変換しない。NULLはNULLのまま維持する。
- 再処理の現在の抽出条件はsummary_failedを除外する。今回変更しない。到達した行の適格性とは別問題。
- whisper --no-summarizeは生成保存/校閲なし。字幕だけ変更されれば版が増え、旧runのcommitをstaleにする。

### C. 状態の保存（DB） migration 037（改訂版）

- `streams.summary_review_status`（legacy_unreviewed / pending / reviewed_no_change /
  auto_fixed / needs_review / review_failed / confirmed）
- `summary_review_base_status`（未確認状態を保存）、`summary_review_version`（本文/字幕/確認の単調版）、
  `summary_success_seen`（false→true、旧空本文はNULL）。これらは非公開。
- `summary_review_runs` 表（run_id PK、UNIQUE(stream_id,input_version)、入力本文/字幕、state、attempt、終端payload）
- `summary_review_log` 表（PK(run_id,finding_no)、run/stream複合FK、rule_id / evidence / before/after / confidence）
- **`is_reviewed ⇔ confirmed` の同値を双方向トリガー＋CHECK制約で担保**（M-2）
  - 確認解除はbaseの各6状態へ復元。ログ有無は無関係。直接UPDATEとNULLもテスト。
- RPCは次表の契約。ロック順はstreams→run、入力版/本文/字幕照合、終端payload同一再送は更新なし。
- DB不能時は状態未確定として停止。ローカル開始台帳は不要（保存時DB runが開始前記録）。
- RLS: service_role SELECT限定・anon/authenticated/PUBLIC 剥奪。書込みは所有者のSECURITY DEFINER RPCのみ
- 公開は `summary_review_status` 列のみ、詳細ログは管理者限定

| RPC（引数は順序も固定） | jsonb戻り値 |
|---|---|
| save_generated_summary(p_stream_id uuid,p_expected_version bigint,p_summary_text text,p_review_run_id uuid) | {stream_id,is_review_locked,was_first_summary_success,review_run_id,version} |
| claim_summary_review_run(p_review_run_id uuid,p_stream_id uuid,p_attempt_id uuid,p_previous_attempt_id uuid) | {state,claimed,attempt_id} |
| commit_summary_review_run(p_review_run_id uuid,p_stream_id uuid,p_attempt_id uuid,p_findings jsonb,p_summary_text text,p_new_status text) | {state,replayed} |
| update_summary_review_state(p_stream_id uuid,p_expected_version bigint,p_is_reviewed boolean,p_status text,p_base text) | void。service_role限定、SECURITY DEFINER/search_path=pg_catalog。行ロック後に入力境界検証：不存在→`summary_review: stream_not_found`、NULL状態パラメータ/版NULL→`summary_review: state_params_required`（正規化なし）、版不一致→`summary_review: version_conflict`、定義域外→`summary_review: invalid_state`。非confirmedはstatus=base、confirmedはstatus=confirmed＋base6状態。不一致は旧値同値の明示指定を含め両方向とも`summary_review: contradictory_status_base_update`。state3列のみUPDATE、本文/字幕不変。expected_versionは時点ガード（状態ラベルのみの変更は版不変、bool変更は既存triggerにより増加） |

commitのp_new_statusはreviewed_no_change/auto_fixed/needs_review/review_failedのみ。無変更/失敗は入力本文と[]。
runはpending→running→succeeded/failed/stale。failed/runningは元worker停止後の旧attempt CASでのみ同一runを再開。
succeeded/staleは再開しない。同じattempt終端の同一payloadはno-op、異なるpayload/別stream/旧attemptは拒否。
confirmed又は入力変更でrunをstaleにして本文/ラベルは触らない。streams.status（公開可否）はいずれのRPCも変更しない。

復旧はrun_id/stream_id照会→成功結果採用又は同一run再開。保存応答喪失はrun存在確認後にだけ同じ保存前版で再送。
LLM失敗でDB接続可ならreview_failedをcommit。DB不能中にreview_failedの永続化を保証しない。
単純再試行1回後も同根因なら停止して主担当へ返す。新しいキューや無期限自動再試行は実装しない。

### D. 「要約確認前」の表示（フロントエンド）

- 状態ごとの表示（§4 表のとおり）。
- `needs_review` の詳細（どこに何が気になるか）は**管理者限定のServer Action**経由。
  公開画面に字幕抜粋を出さない（M-4）。
- 現行一覧/詳細/確認解除のbool更新もDBトリガーで同期。両列を変更する場合の矛盾入力は拒否。

## テスト（must-fix の DoD を固定）

| テスト | 固定する内容 |
|---|---|
| 証拠契約 | 根拠不足の候補・LLM作話候補が必ず needs_review になり、本文を書き換えない（M-1） |
| 状態往復 | base全6値×確認/解除。reviewed_no_change＋0 findingでも同じ状態。再校閲を起動しない（M-2） |
| 全管理経路 | 一覧・詳細・mark・直接bool/状態UPDATE・両方矛盾・NULL INSERT/UPDATEはfalseと同値。INSERT正規入力の一意性（true⇔confirmed／false＋非confirmed6状態）。非confirmed6状態のINSERTは(status, base)一致ペアで通過（version=0・最終正規化でstatus不変）。矛盾INSERT両方向（is_reviewed=false＋status=legacy_unreviewed＋base=pending〔2026-11-11 kana指摘ケース・修正前は公開ラベルがbaseのpendingに置き換わる〕／status=pending＋base=legacy_unreviewed）は `summary_review: contradictory_status_base_insert` で拒否。base省略（列default）＋非legacyの非confirmed statusも拒否（正規入力ペア必須）。confirmed INSERT（true＋confirmed＋base全6状態）は通過しbase保持（解除時の復元先）。既存の矛盾INSERT（true＋非confirmed／false・NULL＋confirmed）は `summary_review: contradictory_confirmation_insert` で拒否（維持）。UPDATE両変更の不一致は両方向で拒否（status=`pending`＋base=`review_failed`／status=`review_failed`＋base=`pending`→`summary_review: contradictory_status_base_update`）・両変更の一致ペアは通過・単独更新（statusのみ→base自動同期／baseのみ→公開ラベル追従）とconfirmed遷移＋base指定（復元先の保存）は従来どおり・INSERT側規則は不変（2026-11-11改訂2）。本文編集時のbase失効と確認中ラベル保持（M-2）。第4修正RPC行列：旧値同値指定の不一致両方向→`summary_review: contradictory_status_base_update`、一致6状態/confirmed往復通過、版不一致→`summary_review: version_conflict`、NULL→`summary_review: state_params_required`、定義域外→`summary_review: invalid_state`、service_role限定。直接UPDATEの同値SET=no-opも両方向テスト。037同梱DO節・下記実行範囲を参照 |
| 経路横断 | **通常、--video、reprocess_one、whisper各々**×初成功/初失敗後成功/過去成功→失敗→成功/NULL・空・空白本文/旧成功/旧履歴不明。初成功のみrun、旧不明は保存可・runなし・base不変（M-3・案A） |
| 経路例外なし | reprocessの直接summary UPDATEが残らない。whisper --no-summarizeは保存/校閲なし。抽出ポリシー不変（M-3） |
| 初成功競合 | 同一streamへの並行保存は一方だけrun作成。敗者は版競合、再読取後は再生成。save応答喪失再送は上書きなし |
| 権限 | anon/authenticatedはrun/log/内部列/RPC不可、公開状態だけ可。service_roleはrun/log SELECTのみ・RPC経由変更可。既存026の字幕非公開維持（M-4） |
| claim | 同時初claim一方のみ、previous=NULLのrunning奪取不可、旧attempt CAS復旧、同一attempt再送で二重実行しない |
| 冪等性 | 0 finding成功run、同payload再送、改変再送、別stream run_id、旧attempt、成功後手動確認→古い再送。本文/状態巻戻しなし（M-5） |
| 入力競合 | claim後に本文/字幕変更・確認・確認解除・ABA。古いcommitはstale、本文/公開状態/log無変更 |
| 再保存時の旧run終端化 | 成功歴true行への非first保存でpending/running/failedの旧runを同一txでstale化（終端理由payload記録・未claim attempt NULL許容）。first保存・失敗/空本文では終端化しない。旧workerの後続commitは終端payload不一致で拒否（M-5・2026-11-03） |
| 原子性 | finding途中失敗・run終端更新失敗で本文/log/run/baseすべてrollback。無効JSON/NULL/状態矛盾/未記録修正を拒否（M-5） |
| 障害/回復 | 公式不能→needs_review、LLM失敗→review_failed。保存前/claim応答喪失/commit応答喪失/DB断/worker停止後の復旧照会と同一run再開。再試行上限で停止 |

第4修正で「全管理経路」に追加するRPC行列：旧値status=base=legacy_unreviewedから
status=pending/base=legacy_unreviewedとその逆方向を `summary_review: contradictory_status_base_update` で拒否。
一致ペア6状態、confirmed＋base6状態/解除、版不一致（`summary_review: version_conflict`）、
NULL bool/status/base/版（`summary_review: state_params_required`）、定義域外（`summary_review: invalid_state`）、
不存在（`summary_review: stream_not_found`）、実効ACLでanon/authenticated/PUBLICのEXECUTE剥奪とservice_role付与を検査。
直接UPDATEの両変更不一致・一致ペア・単独同期・bool往復・confirmed＋base指定・ABA/版単調・
同値SET=no-opの両方向、INSERT行列、backfill整合・CHECK存在・RLS有効化も
037末尾の `M-2 EXECUTION TESTS` DO節に同梱（適用時自動実行・失敗時はmigration失敗・fixtureは自己rollback）。
上記は**将来適用時に実行するテスト**。今回はSQL未適用、静的照合はDB制約・RLS・並行性の実証ではない。

## 手順（フェーズ）

| フェーズ | 内容 | 前提 |
|---|---|---|
| 0 | 今回：設計/計画/未適用037の静的照合だけで主担当へ返す | 他エージェント・台帳・DB操作なし |
| 1 | 旧空本文の成功履歴根拠を確認しNULLの扱いを承認 | **✅ 2026-11-01 一幖承認（案A）**: 生成・保存は維持、校閲だけ対象外・人手確認へ。履歴監査は将来の別作業（必須でない） |
| 2 | DB設計・API/戻り値変更と実装scopeの承認、SQL/並行性テスト | 別承認。先に本番へ適用しない |
| 3 | borma: SQL検証、ishikawa:共通保存＋全経路＋校閲、togusa:上記テスト行列 | 将来の担当案。今回起動しない |
| 4 | paz:状態表示・管理者のみ詳細取得。未適用SQLと統合テスト | 実装承認後 |
| 5 | 既存worker停止を含む切替計画確認→migrationと全保存側を整合反映 | 本番操作はさらに別承認。旧writerと併走しない |
| 6 | 20〜30件の測定→拡大判断 | N-1閾値は未決・一幾判断 |

## 未確定・要確認

- 校閲モジュールの具体構成（1モジュール想定。内部で候補抽出と根拠判定を分離）
- 公式情報の取得方法（手動照合データか取得処理か。失敗時は設計§7のneeds_review）
- 表示文言の最終確定（「要約確認前」で仮確定）
- 旧空本文の成功履歴は現行列だけで判定不能（案Aで校閲対象外として運用。履歴監査は将来の別作業）。
- N-1の拡大数値閾値はopenのまま。finding severity/follow_up/dodは変更しない。

## 非対象

- 要約生成そのものの精度改善（プロンプト改良）
- 字幕の誤変換の根本対策
- 過去成功済みの再生成への校閲、抽出条件/自動リトライ改善、アプリ実装、SQL適用、本番操作
