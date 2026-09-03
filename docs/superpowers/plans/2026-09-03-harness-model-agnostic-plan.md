# ハーネスのAIモデル非依存化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開発ハーネス（エージェント実行スクリプト・ルールファイル）とアプリのLLM呼び出しの双方から「特定のAIモデル/CLIへの固定」を排除する。今後の主軸である Codex を中心に、z.ai・OpenCode を併用しても同じリポジトリ規約で作業でき、モデル世代が上がってもコード変更なしで追従できる状態にする。

**Architecture:** 2層に分けて対処する。**(1) 開発ハーネス層** — `scripts/codex-run.sh` を CLI 非依存の `scripts/agent-run.sh` に置き換え、使用CLI（codex/opencode）とモデルIDを環境変数で切り替える。プロバイダ接続（z.ai 等の base_url / API キー）はスクリプトに実装せず、各CLI自身の設定へ環境変数をパススルーする方式に統一する。ルールファイルは `AGENTS.md` を唯一の正本とし、`CLAUDE.md` は薄いポインタに留めてツール間で対称にする。**(2) アプリLLM層** — モデルIDのハードコードを `os.getenv(..., DEFAULT)` の遅延評価に置き換える。プロバイダ抽象化レイヤ（Gemini/OpenAI共通インターフェース）は本計画では**導入しない**（過剰投資のため。必要になった時点で別計画とする）。

**Tech Stack:** Bash（エージェント実行スクリプト）/ Python 3.11（packages/pipeline、google-genai・openai SDK）/ Next.js App Router + TypeScript（apps/web、Gemini REST を fetch で直叩き）/ pytest（pipeline）・Playwright（web）

## 背景：2026-09-02 ハーネス調査で検出した実態

| 層 | 箇所 | 現状 | 問題 |
|---|---|---|---|
| 開発 | `scripts/codex-run.sh:12` | `MODEL="${2:-gpt-5.4}"`、`codex exec` 決め打ち | OpenCode / z.ai で実行不可。既定モデルが古い |
| 開発 | `scripts/codex-run.sh:36` | 「Claude Codeで『確認して』と伝えてください」 | 特定ツール前提の手順が固定文言化 |
| 開発 | `AGENTS.md`（ルート） | ✅ 標準形式で良好 | 非依存性はここだけ担保済み |
| 開発 | `apps/web/CLAUDE.md` | 中身は `@AGENTS.md` のみ。ルートには CLAUDE.md 無し | ツール間で読み込み対称性が崩れている |
| 開発 | `.env.local.example` | z.ai / OpenCode 用の受け口が無い | 新環境の立ち上げ手順が暗黙知化 |
| アプリ | `packages/pipeline/summarize.py:25` | `MODEL_NAME = "gemini-2.5-flash"` | env上書き不可 |
| アプリ | `packages/pipeline/summarize.py:2` | docstring「Gemini **1.5** Flash」 | 実装（2.5）と不一致 |
| アプリ | `packages/pipeline/weekly_magazine.py:36-37` | `gemini-2.5-flash` / `gpt-image-2` | env上書き不可 |
| アプリ | `packages/pipeline/whisper_transcribe.py:52,78` | `whisper-1` / `mlx-community/whisper-large-v3-turbo` | env上書き不可・旧世代 |
| アプリ | `packages/pipeline/compare_covers.py:33,44,61` | `gemini-2.5-flash` と `gemini-3.1-flash-image` が混在 | 同一リポジトリ内で世代不一致 |
| アプリ | `apps/web/src/app/admin/actions.ts:811` | エンドポイントURLにモデル名とAPIバージョンを直書き | 変更に再デプロイが必須 |
| ドキュメント | `docs/ichiro-library-spec.md:43,61,229,395,419` | 「Gemini 1.5 Flash」表記（6箇所） | 実装と2世代分の乖離 |

調査時点で **モデル名を環境変数で上書きできる箇所はゼロ**（`grep -rn "getenv|environ" --include="*.py" | grep -i model` が0件）。

## Global Constraints

- **既定値は現行の実装値を維持する。** 本計画は「切り替えられる状態」を作るのが目的であり、モデルのアップグレード自体は含まない（モデル世代の更新は Task 6 の確認事項として分離）
- **プロバイダ抽象化レイヤは作らない。** `google.genai` の例外型（`genai_errors.APIError`）への依存は現状のまま残す。差し替えが実需になった時点で別計画を立てる
- **`os.getenv` は遅延評価（関数内）で行う。** `summarize.py` 自身は `load_dotenv` を呼ばず、呼び出し元（`worker.py` / `test_summarize.py` 等）が import 前に読み込む構造のため、モジュールトップレベルで `getenv` を評価すると import 順によって `.env.local` の値を取りこぼす
- **`store.py:138` の `from summarize import MODEL_NAME` は関数内 import** であり、ここを新しいアクセサに置き換えることで DB の `streams.ai_model` 列に実際に使用したモデル名が記録される状態を保つ（記録内容の後退は許容しない）
- **AGENTS.md の Secret Handling 規約を厳守する。** `.env.local.example` への追記時も値は書かず、変数名と取得先URLのみ記載する
- z.ai / OpenCode の接続設定（base_url・認証方式）は各CLI側の設定ファイルで行い、`agent-run.sh` には実装しない。スクリプトは環境変数をパススルーするだけに留める（未検証の接続仕様をコードに固定しないため）

---

## Task 1: エージェント実行スクリプトをCLI非依存化する

**Files:**
- Rename: `scripts/codex-run.sh` → `scripts/agent-run.sh`（`git mv` を使う）
- Modify: `README.md`（実行手順の節に追記）

**Interfaces:**
- Produces: 環境変数 `AGENT_CLI`（`codex` | `opencode`、既定 `codex`）、`AGENT_MODEL`（未指定ならCLI既定に委ねる＝`-m` を渡さない）

- [ ] **Step 1: `git mv scripts/codex-run.sh scripts/agent-run.sh` でリネームする**

旧名の互換ラッパは残さない（README・docs 内に `codex-run` への参照が0件であることを確認済み）。

- [ ] **Step 2: CLI・モデルの決め打ちを撤廃する**

- `MODEL="${2:-gpt-5.4}"` → `AGENT_MODEL="${2:-${AGENT_MODEL:-}}"` とし、**空なら `-m` オプション自体を渡さない**（各CLIの既定モデルを尊重する）
- `AGENT_CLI="${AGENT_CLI:-codex}"` を追加し、`codex` / `opencode` で起動コマンドを分岐する
- 分岐は case 文で書き、未知の値は `echo "未対応のAGENT_CLI: $AGENT_CLI" >&2; exit 1` で明示的に落とす
- 末尾の「Claude Codeで『確認して』と伝えてください」を、ツール名を含まない文言（例:「レビュー担当のエージェントに差分確認を依頼してください」）に置き換える

- [ ] **Step 3: 実行確認する**

Run: `AGENT_CLI=codex bash -n scripts/agent-run.sh`
Expected: 構文エラーなし（`bash -n` は構文チェックのみで実行しない）

Run: `AGENT_CLI=unknown ./scripts/agent-run.sh docs/phase4-codex-brief.md`
Expected: 「未対応のAGENT_CLI」で exit 1。CLIが未インストールでもここまで到達する

- [ ] **Step 4: README に使い方を追記する**

`AGENT_CLI` / `AGENT_MODEL` の指定例（codex / opencode の2パターン）と、「モデル指定を省略した場合はCLI既定に従う」旨を記載する。

---

## Task 2: エージェントルールファイルをツール間で対称にする

**Files:**
- Create: `CLAUDE.md`（リポジトリルート）
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `AGENTS.md` を唯一の正本とする構造（CLAUDE.md は1行のポインタのみ）

- [ ] **Step 1: ルートに `CLAUDE.md` を作成する**

内容は `apps/web/CLAUDE.md` と同じ方式で `@AGENTS.md` の1行のみ。ルールの実体を二重に書かない（`apps/web` 側が既にこのパターンなので構造を揃えるだけ）。

- [ ] **Step 2: `AGENTS.md` に「使用エージェント」節を追記する**

- 本リポジトリは Codex を主軸に、z.ai・OpenCode・Claude Code を併用する前提であること
- どのツールで作業しても `AGENTS.md` が唯一の規約正本であること
- エージェント実行スクリプトは `scripts/agent-run.sh`（CLI・モデルは環境変数で切替）であること

既存の Secret Handling / Scope 節は変更しない。

- [ ] **Step 3: 参照が壊れていないか確認する**

Run: `grep -rn "codex-run\|CLAUDE.md" --include="*.md" . | grep -v node_modules`
Expected: `codex-run` への参照が0件。`CLAUDE.md` はルートと `apps/web` の2ファイルのみで、いずれも `@AGENTS.md` を指す

---

## Task 3: pipeline のモデルIDを環境変数で上書き可能にする

**Files:**
- Modify: `packages/pipeline/summarize.py`
- Modify: `packages/pipeline/store.py`
- Modify: `packages/pipeline/weekly_magazine.py`
- Modify: `packages/pipeline/whisper_transcribe.py`
- Modify: `packages/pipeline/compare_covers.py`

**Interfaces:**
- Produces: `GEMINI_MODEL` / `GEMINI_IMAGE_MODEL` / `OPENAI_IMAGE_MODEL` / `WHISPER_MODEL` / `WHISPER_LOCAL_MODEL`
- Consumes: `summarize.get_model_name()`（`store.py` および `summarize.py` 内部から呼ぶ）

- [ ] **Step 1: `summarize.py` にアクセサを追加する**

```python
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


def get_model_name() -> str:
    """実行時に使用する Gemini モデル名。GEMINI_MODEL で上書きできる。"""
    return os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_GEMINI_MODEL
```

`MODEL_NAME` 定数は**削除する**（モジュール読み込み時評価だと `.env.local` を取りこぼすため、残すと誤用の温床になる）。`_generate_with_retry` 内の `model=MODEL_NAME` を `model=get_model_name()` に置き換える。

- [ ] **Step 2: `store.py:138` の import を差し替える**

`from summarize import MODEL_NAME, TARGET_PROMPT_VER` → `from summarize import get_model_name, TARGET_PROMPT_VER` とし、`return get_model_name(), TARGET_PROMPT_VER` に変更する。

- [ ] **Step 3: 残りのモデルIDを同じ方式に揃える**

| ファイル | 現状 | 変更後（既定値は現行維持） |
|---|---|---|
| `weekly_magazine.py:36` | `MODEL_NAME = "gemini-2.5-flash"` | `summarize.get_model_name()` を再利用する |
| `weekly_magazine.py:37` | `IMAGE_MODEL = "gpt-image-2"` | `os.getenv("OPENAI_IMAGE_MODEL") or "gpt-image-2"`（`load_dotenv` 後に定義済みのためトップレベル評価で可） |
| `whisper_transcribe.py:52` | `model="whisper-1"` | `os.getenv("WHISPER_MODEL") or "whisper-1"`（関数内で評価） |
| `whisper_transcribe.py:78` | 既定引数 `"mlx-community/whisper-large-v3-turbo"` | 既定引数を `None` にし、関数内で `WHISPER_LOCAL_MODEL` → 現行値の順にフォールバック |
| `compare_covers.py:33` | `model="gemini-2.5-flash"` | `summarize.get_model_name()` |
| `compare_covers.py:44` | `model="gemini-3.1-flash-image"` | `os.getenv("GEMINI_IMAGE_MODEL") or "gemini-3.1-flash-image"` |
| `compare_covers.py:61` | `model="gpt-image-2"` | `os.getenv("OPENAI_IMAGE_MODEL") or "gpt-image-2"` |

`weekly_magazine.py:161,390` のログ・コメント内の `gpt-image-2` リテラルも実際の変数を参照する形に直す。

- [ ] **Step 4: テストを通す**

Run: `cd packages/pipeline && python -m pytest`
Expected: 全件パス。特に `tests/test_store_tags.py`（`ai_model` 記録）と `tests/test_gemini_error_classification.py` が緑であること

Run: `cd packages/pipeline && GEMINI_MODEL=test-model-x python -c "import summarize; print(summarize.get_model_name())"`
Expected: `test-model-x` が出力される（env上書きが効いている）

Run: `cd packages/pipeline && python -c "import summarize; print(summarize.get_model_name())"`
Expected: `gemini-2.5-flash`（既定値が変わっていない）

---

## Task 4: web 側の Gemini エンドポイントを組み立て式にする

**Files:**
- Modify: `apps/web/src/app/admin/actions.ts`

**Interfaces:**
- Consumes: `GEMINI_MODEL`（pipeline と同じ変数名を共有する）、`GEMINI_API_VERSION`（既定 `v1beta`）

- [ ] **Step 1: URL定数を関数化する**

`actions.ts:811` の

```ts
const GEMINI_GENERATE_CONTENT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
```

を、`process.env.GEMINI_MODEL` / `process.env.GEMINI_API_VERSION` から組み立てる関数に置き換える。既定値は `gemini-2.5-flash` / `v1beta` で現行と完全一致させる。Server Action 内で実行されるため実行時評価で問題ない。

- [ ] **Step 2: 型チェックとビルドを通す**

Run: `cd apps/web && npx tsc --noEmit`
Expected: エラー0件

Run: `cd apps/web && npm run build`
Expected: ビルド成功

Run: `cd apps/web && npx eslint src/app/admin/actions.ts`
Expected: エラー0件

**注意:** Playwright を使うUI/E2Eテストは `apps/web/AGENTS.md` の制約により Codex サンドボックスから実行できない。ブラウザ起動を伴う確認はメンテナのターミナルで行う。

---

## Task 5: 環境変数テンプレートとドキュメントを実装に一致させる

**Files:**
- Modify: `.env.local.example`
- Modify: `packages/pipeline/summarize.py`（docstring）
- Modify: `docs/ichiro-library-spec.md`
- Modify: `README.md`

- [ ] **Step 1: `.env.local.example` に新規変数を追記する**

`GEMINI_MODEL` / `GEMINI_API_VERSION` / `GEMINI_IMAGE_MODEL` / `OPENAI_IMAGE_MODEL` / `WHISPER_MODEL` / `WHISPER_LOCAL_MODEL` を「任意・未設定ならコード内既定値」と明記して追加する。あわせて開発エージェント用の節（`AGENT_CLI` / `AGENT_MODEL`、z.ai を使う場合の接続変数は各CLIの設定に委ねる旨）をコメントで追加する。**値は一切書かない**（AGENTS.md の Secret Handling 準拠）。

- [ ] **Step 2: 古いモデル記述を修正する**

| 箇所 | 修正内容 |
|---|---|
| `packages/pipeline/summarize.py:2` | 「Gemini 1.5 Flash で〜」→ 特定世代名を書かず「Gemini（既定 `gemini-2.5-flash`、`GEMINI_MODEL` で切替可）」 |
| `docs/ichiro-library-spec.md:43,61,229,395,419` | 「Gemini 1.5 Flash」→ 同上の表記に統一 |
| `docs/ichiro-library-spec.md:419` | コスト試算の前提モデル名を実装値に合わせる（金額そのものは再計算しない。要確認事項として注記を残す） |
| `README.md:85,89` | 「Gemini要約」等の記述に、モデルが環境変数で切替可能である旨を1行追記 |

- [ ] **Step 3: ハードコード残存をゼロ確認する**

Run: `grep -rnE "gemini-[0-9]|gpt-image-|whisper-1|gpt-5" --include="*.py" --include="*.ts" --include="*.sh" . | grep -v node_modules`
Expected: ヒットするのは各ファイルの**既定値定義行のみ**（`DEFAULT_GEMINI_MODEL` や `os.getenv(...) or "..."` の右辺）。呼び出し箇所に直接リテラルが残っていないこと

---

## Task 6: 実施後の確認事項（本計画のスコープ外・要判断）

実装完了後、メンテナ判断が必要な項目。**本計画では変更しない。**

- [ ] **モデル世代の更新可否** — 既定の `gemini-2.5-flash` を上位世代に上げるか。同一リポジトリ内の `compare_covers.py` は既に `gemini-3.1-flash-image` を使用しており世代不一致がある。公式ドキュメントで現行モデルIDと料金を一次情報として確認したうえで判断する（調査時点では未確認）
- [ ] **`whisper-1` の後継への移行可否** — 音声認識モデルの現行世代を確認し、`WHISPER_MODEL` の既定値を更新するか判断する
- [ ] **z.ai の接続方式の確定** — Anthropic互換 / OpenAI互換のどちらで接続するか、必要な環境変数名と base_url を実機で確認し、確定後に `.env.local.example` と README へ反映する
- [ ] **OpenCode の設定ファイルをリポジトリに置くか** — `opencode.json` 等をコミットして共有するか、各自のローカル設定に委ねるか
- [ ] **プロバイダ抽象化レイヤの要否** — 実際に Gemini 以外へ差し替える必要が生じた場合のみ、`genai_errors.APIError` 依存（`summarize.py` / `reprocess_videos.py:581` / `tests/conftest.py:28-35`）の解消を別計画として立てる

---

## リスクと緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| `getenv` のトップレベル評価で `.env.local` を取りこぼす | モデル指定が無視され、既定値で動く（**サイレント失敗**） | Task 3 Step 1 の通り遅延評価を徹底。Step 4 の env上書き確認コマンドで検証する |
| `MODEL_NAME` 定数削除により未知の参照が壊れる | `ImportError` で pipeline が停止 | 削除前に `grep -rn "MODEL_NAME" packages/` で参照を全列挙し、`store.py` 以外に無いことを確認する |
| `streams.ai_model` に誤った値が記録される | 過去データとの整合性が崩れる | Task 3 Step 2 で `get_model_name()` に差し替え、`tests/test_store_tags.py` で検証する |
| スクリプトのリネームでメンテナのローカル手順が壊れる | 実行時に「ファイルが見つかりません」 | README に新旧対応を明記。参照が docs 内に0件であることは確認済み |
