# ichiro-library Phase 6C: カバープロンプト テキスト混入修正（Codex向け）

> 設計確定: Claude + Codex 3ラウンドdebate後 — 2026-06-17
> 根拠: `10_system/debate/2026-06-17_cover-prompt-no-text.md`
> 変更対象: 2ファイル（weekly_magazine.py, compare_covers.py）

---

## 問題

gpt-image-2 が生成するカバー画像に日本語テキストが混入する。
原因: `COVER_PROMPT_TEMPLATE` にある「NO text」指示がGeminiへの動作制約として読まれ、
gpt-image-2 へ渡す最終プロンプトに「No text」句が引き継がれなかった。

---

## タスク1: `packages/pipeline/weekly_magazine.py` の修正

### 1-A: `COVER_PROMPT_TEMPLATE` を以下に**丸ごと置き換える**

```python
COVER_PROMPT_TEMPLATE = """You are an art director for a Japanese weekly music editorial platform called "いっくん追いかけマガジン".
Generate a weekly vertical editorial image for a UI hero slot; all typography will be composited externally after generation.

Output ONLY the English image prompt text (max 80 words). No explanations, no labels, no code blocks, no Japanese.

FIXED STYLE (always include ALL of these in your output prompt):
- vertical Japanese editorial artwork, 2:3 portrait format, pure visual illustration — no masthead space, no headline area, no text zones
- two-tone or near-monochrome graphic style: black ink, charcoal, warm white paper, one muted cool gray/blue accent only
- quiet, intellectual, urban, art-book quality — not a flyer, not a YouTube thumbnail, not a product photo
- cover concept must come from this week's actual topics, mood, songs, and motifs
- do not make a realistic face or likeness; if a person appears, use a mature 45-year-old presence only as back-view silhouette, side-profile shadow, hand, glasses, microphone, or coat
- the human presence must feel middle-aged, grounded, slightly tired: heavy black coat, lowered shoulders, calm adult stillness; never youthful or idol-like
- avoid saturated colors, crowded layouts, direct photo likeness, young faces

THIS WEEK'S CONTENT:
- Headline: {headline}
- Topics: {topics}
- Songs featured: {songs}
- Mood distribution: {mood}
- Key motifs to consider: water, fish, night cityscape, music, microphone, guitar

Output the prompt now."""
```

### 1-B: `_sanitize_cover_prompt(raw, label)` 関数を `_make_cover` の直前に追加

```python
def _sanitize_cover_prompt(raw: str, label: str) -> str:
    """Gemini出力を正規化し gpt-image-2 用プロンプトに変換する。"""
    import re

    # 1. fenced code block があれば中身を抽出（ブロックごと削除しない）
    m = re.search(r"```[a-z]*\n?(.*?)```", raw, flags=re.DOTALL)
    if m:
        raw = m.group(1)

    # 2. 先頭の前置き行を除去（本文が同一行に続く場合は行ごと削除しない）
    #    "Prompt: " のように前置きが本文と同行なら前置き部分のみ除去
    raw = re.sub(
        r"^[\s>]*(?:here(?:'s| is)(?: the)?(?:\s+(?:image\s+)?(?:generation\s+)?prompt)?|"
        r"prompt|image prompt|cover prompt|english prompt|生成プロンプト|画像生成プロンプト|"
        r"プロンプト|以下です?|こちらです?|以下の通りです?)\s*[:\-：]\s*",
        "", raw, flags=re.IGNORECASE,
    ).strip()

    # 3. 先頭の箇条書き・番号を除去
    raw = re.sub(
        r"^[\s>]*(?:\d+[\.\)、）]|[①-⑨]|[・\-\*\•\–\—]\s*)",
        "", raw.strip(),
    ).strip()

    # 4. 外側の引用符を除去（curly quotes含む）
    raw = raw.strip('"\'「」『』`“”‘’')

    # 5. CJK文字を除去（警告込み）
    if re.search(r"[　-鿿＀-￯]", raw):
        logger.warning(f"[{label}] プロンプトに日本語/CJK文字を検出 — 除去します")
        raw = re.sub(r"[　-鿿＀-￯]+\s*", "", raw).strip()

    # 6. 空チェック
    if not raw:
        raise ValueError(f"[{label}] Gemini のプロンプト出力がサニタイズ後に空になりました")

    # 7. 誘発語を置換（"magazine cover" 系・"masthead" 系）
    TRIGGER_SUBS = [
        (r"(?i)\bmagazine(?:\s+cover)?\b", "editorial"),
        (r"(?i)\bcover\s+art(?:work)?\b", "editorial artwork"),
        (r"(?i)\bcover\s+illustration\b", "editorial illustration"),
        (r"(?i)\bfront\s+cover\b", "editorial artwork"),
        (r"(?i)\bcover\s+(?:design|layout|image)\b", "editorial artwork"),
        (r"(?i)\bmasthead(?:\s+\w+)?\b", ""),
        (r"(?i)\bheadline[\s\-](?:area|zone|space)\b", ""),
        (r"(?i)\btitle[\s\-]safe\b", ""),
        (r"(?i)\bmagazine[\s\-]style\b", "editorial"),
    ]
    for pattern, repl in TRIGGER_SUBS:
        raw = re.sub(pattern, repl, raw)
    raw = re.sub(r"  +", " ", raw).strip()

    # 8. 禁止句を末尾に付加（既に "no text" が含まれる場合はスキップ）
    NO_TEXT = (
        "No text, letters, words, numbers, kanji, kana, roman characters, "
        "pseudo-writing, glyphs, labels, captions, logos, watermarks, "
        "street signs, storefront signs, neon signs, or billboards anywhere."
    )
    if "no text" not in raw.lower():
        raw = raw.rstrip("., ") + ". " + NO_TEXT

    # 9. 長さ制限（800 chars）— 文境界で切り詰め
    MAX = 800
    if len(raw) > MAX:
        cutoff = MAX - len(". " + NO_TEXT)
        last_dot = raw[:cutoff].rfind(". ")
        trim_at = (last_dot + 2) if last_dot > 0 else cutoff
        raw = raw[:trim_at].rstrip() + " " + NO_TEXT
        logger.warning(f"[{label}] プロンプトを {MAX} chars に切り詰めました ({len(raw)} chars)")

    logger.info(f"[{label}] sanitized prompt ({len(raw)} chars): {raw[:100]}...")
    return raw
```

### 1-C: 呼び出し箇所を差し替え

`generate_cover_image()` 内の該当箇所を以下に変更:

```python
# 変更前
prompt_response = _generate(client, cover_prompt_request)
image_prompt = prompt_response.strip()

# 変更後
prompt_response = _generate(client, cover_prompt_request)
logger.info(f"[{label}] Gemini raw prompt: {prompt_response.strip()[:100]}...")
image_prompt = _sanitize_cover_prompt(prompt_response, label)
```

`_sanitize_cover_prompt` が `ValueError` を送出した場合は、既存の `except Exception as e` ブロックで補足される。追加の try/except は不要。

---

## タスク2: `packages/pipeline/compare_covers.py` の同期

`compare_covers.py` に独自の `COVER_PROMPT_TEMPLATE` が定義されている場合、以下に変更:

```python
# compare_covers.py の先頭 import に追加
from weekly_magazine import COVER_PROMPT_TEMPLATE, _sanitize_cover_prompt
```

compare_covers.py 内に `image_prompt = ...` の生成箇所があれば、サニタイズ処理を同様に適用:

```python
# compare_covers.py 内の gpt-image-2 への送信前
image_prompt = _sanitize_cover_prompt(raw_prompt, label="compare")
```

独自の `COVER_PROMPT_TEMPLATE` 定義は削除する（weekly_magazine.py をSSoTにする）。

---

## 完了確認チェックリスト

- [ ] `COVER_PROMPT_TEMPLATE` に `magazine cover artwork` / `fashion/culture magazine cover artwork` が含まれていないこと
- [ ] `COVER_PROMPT_TEMPLATE` に `Output ONLY the English image prompt text` の指示が含まれること
- [ ] `_sanitize_cover_prompt` 関数が `_make_cover` の直前に存在すること
- [ ] `generate_cover_image()` 内で `image_prompt = _sanitize_cover_prompt(...)` を呼んでいること
- [ ] `logger.info(f"[{label}] Gemini raw prompt: ...")` がサニタイズ前に出ていること
- [ ] `compare_covers.py` が `weekly_magazine.py` から `COVER_PROMPT_TEMPLATE` と `_sanitize_cover_prompt` を import していること
- [ ] `python -c "import ast; ast.parse(open('weekly_magazine.py').read()); print('OK')"` が通ること
- [ ] `python -c "from weekly_magazine import _sanitize_cover_prompt; print(_sanitize_cover_prompt('Here is the prompt: Vertical art. Quiet mood.', 'test'))"` が `No text, letters...` を含む文字列を返すこと

---

## 重要な制約

1. `_generate()` / `_mood_from_highlights()` / `_make_cover()` / `generate_cover_image()` の他の部分は変更しない
2. `response_format="b64_json"` は Phase 6 で既に削除済み — 再追加しないこと
3. `MAGAZINE_PROMPT` は変更しない（カバー画像とは別のGemini呼び出し）
4. サニタイズ後のプロンプトを DB の `cover_prompt` カラムに保存する（現行の挙動を維持）
