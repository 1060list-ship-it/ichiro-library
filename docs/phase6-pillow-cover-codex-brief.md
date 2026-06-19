# ichiro-library Phase 6: Pillow カバー合成 実装指示書（Codex向け）

> 設計確定者: Claude Code — 2026-06-14（gpt-image-2採用に更新）
> 実装担当: Codex
> リポジトリルート: このファイルの2つ上（`ichiro-library/`）

## 問題と目的

**現状の問題：** Imagen 4 が `NO text` 指示を無視して画像内に文字ノイズを生成する。
CSSオーバーレイのテキストと重なって表紙が壊れて見える。

**解決策：**

1. 画像生成モデルを **gpt-image-2** に切り替える（比較テストで採用決定）
2. 生成した画像に Python（Pillow）でタイトル・号数・日付・見出しを合成してアップロード
3. フロントエンドの CSS オーバーレイを廃止する

---

## 変更対象ファイル（6つ）

1. `packages/pipeline/weekly_magazine.py` — gpt-image-2への切替 + Pillow合成
2. `packages/pipeline/requirements.txt` — Pillow追加
3. `packages/pipeline/font_utils.py` — フォントDL・キャッシュ（新規作成）
4. `packages/pipeline/.gitignore` — fontsフォルダをgit管理外に（新規作成 or 追記）
5. `apps/web/src/app/magazine/[week]/page.tsx` — CSSオーバーレイ廃止（1行変更）
6. `.github/workflows/magazine.yml` — OPENAI_API_KEY を env に追加

---

## タスク0: `weekly_magazine.py` — gpt-image-2 への切替

### 0-1: インポート追加・変更

ファイル先頭の既存 import ブロックに追加：

```python
import base64
from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
from font_utils import get_font_path
```

`from google.genai import types` は**削除しない**（Gemini テキスト生成で引き続き使用）。

### 0-2: IMAGE_MODEL 定数を変更

```python
# 変更前
IMAGE_MODEL = "imagen-4.0-fast-generate-001"
IMAGE_MODEL = "imagen-4.0-fast-generate-001"

# 変更後
IMAGE_MODEL = "gpt-image-2"
IMAGE_SIZE  = "1024x1536"   # 3:4 縦長
```

### 0-3: `generate_cover_image()` 内の画像生成部分を差し替え

**変更前（Imagen呼び出し）：**

```python
image_response = client.models.generate_images(
    model=IMAGE_MODEL,
    prompt=image_prompt,
    config=types.GenerateImagesConfig(
        number_of_images=1,
        aspect_ratio="3:4",
    )
)
image_bytes = image_response.generated_images[0].image.image_bytes
```

**変更後（gpt-image-2呼び出し）：**

```python
openai_key = os.environ.get("OPENAI_API_KEY")
if not openai_key:
    raise RuntimeError("OPENAI_API_KEY が未設定")
openai_client = OpenAI(api_key=openai_key)
image_response = openai_client.images.generate(
    model=IMAGE_MODEL,
    prompt=image_prompt,
    size=IMAGE_SIZE,
    quality="high",
    n=1,
    response_format="b64_json",
)
image_bytes = base64.b64decode(image_response.data[0].b64_json)
```

`client`（Gemini）引数はそのまま残す。`generate_cover_image()` 内で OpenAI クライアントを新規作成する。

---

## タスク1: `packages/pipeline/requirements.txt` に Pillow を追加

既存行末尾に追記：

```text
Pillow>=10.0.0
```

---

## タスク2: `packages/pipeline/font_utils.py` 新規作成

```python
"""
日本語フォントのダウンロード・キャッシュ。
GitHub Actions / macOS / Linux で同一コードで動作する。
"""
import urllib.request
from pathlib import Path

_FONTS_DIR = Path(__file__).parent / "fonts"
_FONT_PATH = _FONTS_DIR / "NotoSansJP.ttf"

# Google Fonts GitHub — Noto Sans JP 可変フォント（Apache 2.0 / OFL）
_FONT_URL = (
    "https://github.com/google/fonts/raw/main/ofl/notosansjp/"
    "NotoSansJP%5Bwght%5D.ttf"
)


def get_font_path() -> Path:
    """フォントパスを返す。未ダウンロードなら取得してキャッシュする。"""
    if _FONT_PATH.exists():
        return _FONT_PATH
    _FONTS_DIR.mkdir(exist_ok=True)
    urllib.request.urlretrieve(_FONT_URL, _FONT_PATH)
    return _FONT_PATH
```

---

## タスク3: `weekly_magazine.py` — `_make_cover()` 追加 + シグネチャ変更

### 3-1: `_make_cover()` を `generate_cover_image()` の直前に挿入

```python
def _make_cover(
    image_bytes: bytes,
    issue_number: str,
    date_range: str,
    headline: str,
) -> bytes:
    """画像バイト列にテキストをPillow合成してPNGバイト列を返す。"""
    img = Image.open(BytesIO(image_bytes)).convert("RGBA")
    W, H = img.size

    # ── 下部グラデーション ──────────────────────────────────────────────
    grad_h = int(H * 0.52)
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(grad_h):
        alpha = int(217 * (y / grad_h) ** 1.6)
        gd.line([(0, H - grad_h + y), (W, H - grad_h + y)], fill=(0, 0, 0, alpha))
    img = Image.alpha_composite(img, grad)
    draw = ImageDraw.Draw(img)

    # ── フォント ────────────────────────────────────────────────────────
    font_path = str(get_font_path())
    sz_badge    = max(18, int(W * 0.036))
    sz_issue    = max(16, int(W * 0.034))
    sz_date     = max(15, int(W * 0.032))
    sz_headline = max(28, int(W * 0.062))

    def load(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
        f = ImageFont.truetype(font_path, size)
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        return f

    f_badge    = load(sz_badge,    400)
    f_issue    = load(sz_issue,    400)
    f_date     = load(sz_date,     400)
    f_headline = load(sz_headline, 700)

    GRAY  = (195, 195, 210, 255)
    WHITE = (255, 255, 255, 255)
    pad   = int(W * 0.055)

    # ── 上部バッジ ──────────────────────────────────────────────────────
    BADGE_TEXT = "いっくん追いかけマガジン"
    bp = int(W * 0.028)
    bbox_b = draw.textbbox((0, 0), BADGE_TEXT, font=f_badge)
    bw = bbox_b[2] - bbox_b[0] + bp * 2
    bh = bbox_b[3] - bbox_b[1] + bp * 2
    bx, by = pad, pad
    badge_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge_layer)
    bd.rounded_rectangle([(bx, by), (bx + bw, by + bh)], radius=6, fill=(0, 0, 0, 153))
    img = Image.alpha_composite(img, badge_layer)
    draw = ImageDraw.Draw(img)
    draw.text((bx + bp, by + bp - bbox_b[1]), BADGE_TEXT, font=f_badge, fill=GRAY)

    # ── headline 折り返し ────────────────────────────────────────────────
    max_w = W - pad * 2

    def wrap_chars(text: str, font: ImageFont.FreeTypeFont) -> list:
        lines, cur = [], ""
        for c in text:
            test = cur + c
            if draw.textlength(test, font=font) <= max_w:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = c
        if cur:
            lines.append(cur)
        return lines

    hl_lines = wrap_chars(headline, f_headline)

    # ── 下部テキスト（下から積み上げ） ──────────────────────────────────
    bottom_pad = int(H * 0.042)
    line_gap   = int(sz_headline * 0.28)
    hl_h       = sz_headline + line_gap
    hl_total   = hl_h * len(hl_lines)
    hl_y       = H - bottom_pad - hl_total

    for i, line in enumerate(hl_lines):
        draw.text((pad, hl_y + i * hl_h), line, font=f_headline, fill=WHITE)

    date_y  = hl_y - int(sz_date  * 1.9)
    issue_y = date_y - int(sz_issue * 1.9)
    draw.text((pad, date_y),  date_range,   font=f_date,  fill=GRAY)
    draw.text((pad, issue_y), issue_number, font=f_issue, fill=GRAY)

    out = img.convert("RGB")
    buf = BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
```

### 3-2: `generate_cover_image()` のシグネチャに `monday` / `sunday` を追加

```python
# 変更前
def generate_cover_image(client, content: dict, label: str, sb) -> Optional[str]:

# 変更後
def generate_cover_image(
    client, content: dict, label: str, sb,
    monday: "date", sunday: "date"
) -> Optional[str]:
```

### 3-3: gpt-image-2 呼び出し直後に `_make_cover()` を呼ぶ

```python
# gpt-image-2 の image_bytes 取得直後に挿入
date_range    = f"{monday.strftime('%Y/%m/%d')} – {sunday.strftime('%m/%d')}"
issue_display = label.replace("-", "").replace("W", " W")  # "2026 W22" スタイル
image_bytes   = _make_cover(image_bytes, issue_display, date_range, content.get("headline", ""))
```

### 3-4: `generate_magazine()` 末尾の呼び出し行を修正

```python
# 変更前
generate_cover_image(client, content, label, sb)

# 変更後
generate_cover_image(client, content, label, sb, monday, sunday)
```

---

## タスク4: `packages/pipeline/.gitignore` 作成（または追記）

`packages/pipeline/` に `.gitignore` がなければ新規作成、あれば追記：

```
fonts/
compare_output/
```

---

## タスク5: `apps/web/src/app/magazine/[week]/page.tsx` — CSSオーバーレイ廃止

```tsx
// 変更前
const precomposedCover = hasLocalMagazineCover(magazine.week_label)

// 変更後
const precomposedCover = hasLocalMagazineCover(magazine.week_label) || magazine.cover_image_url !== null
```

**この1行のみ。** 他は一切触らない。

---

## タスク6: `.github/workflows/magazine.yml` に OPENAI_API_KEY を追加

既存の `env:` ブロックに1行追記：

```yaml
env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}   # ← 追加
```

---

## 完了確認チェックリスト

- [ ] `requirements.txt` に `Pillow>=10.0.0` が追加されている
- [ ] `font_utils.py` が存在し、`python -c "from font_utils import get_font_path; print(get_font_path())"` で `fonts/NotoSansJP.ttf` が生成される
- [ ] `weekly_magazine.py` の画像生成が `openai_client.images.generate(model="gpt-image-2", ...)` を呼んでいる
- [ ] `_make_cover()` が実装され、gpt-image-2 の出力バイトに対して呼ばれている
- [ ] `generate_cover_image()` が `monday`, `sunday` を受け取り、`generate_magazine()` 末尾から渡されている
- [ ] ローカルで動作確認（既存マガジンがある週の `cover_image_url` を NULL にしてから実行）

  ```bash
  cd /Users/ikkiair/Projects/AI_work/03_personal_projects/ichiro-library/packages/pipeline
  python weekly_magazine.py --weeks-ago 1
  ```

- [ ] Supabase Storage の合成済みPNGを開き、日本語テキストが正しく描画されている
- [ ] `page.tsx` の `precomposedCover` 条件が1行更新されている
- [ ] `magazine.yml` に `OPENAI_API_KEY` が追加されている
- [ ] `.gitignore` に `fonts/` と `compare_output/` が入っている

---

## 重要な制約・注意事項

1. **Gemini クライアント（`client`）はテキスト生成のみ**。画像生成には使わない。
2. **`set_variation_by_axes` は try/except で握り潰す**（freetype バージョン依存）。
3. **既存の `cover_prompt` 保存ロジックは変更しない**。
4. **既存マガジンは自動スキップ**される。過去週の再生成は DB の `cover_image_url` を NULL にして手動実行。
5. **Secret の扱い**は `AGENTS.md` 制約に従う（値をログ・出力に絶対に出さない）。
