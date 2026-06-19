# ichiro-library Phase 6B: 新カバーテンプレートシステム 実装指示書（Codex向け）

> 設計確定者: Claude Code — 2026-06-17
> 実装担当: Codex
> リポジトリルート: このファイルの2つ上（`ichiro-library/`）

## 概要・背景

Phase 6 で実装した `_make_cover()` を完全に置き換える。

**変更理由：**
一幾が Figma/デザインツールで制作した透過 PNG テンプレートを使用し、静的オーバーレイ＋Pillow 可変テキスト合成方式（案B）に移行する。

**方針：**
- `ICHIRO LIBRARY` ロゴ部分 → 静的透過 PNG をそのまま合成
- w番号・日付・見出し → Pillow でフォントを指定して描画
- AI 生成画像が暗い場合は白テキスト、明るい場合は黒テキストに自動切替

---

## 変更対象ファイル（2つのみ）

1. `packages/pipeline/font_utils.py` — Zen Kaku Gothic Antique Bold / Zen Antique Regular を追加
2. `packages/pipeline/weekly_magazine.py` — `_make_cover()` を完全書き換え

---

## タスク1: `font_utils.py` の更新

### 現在の内容
NotoSansJP のみ対応。

### 変更後の仕様

`font_utils.py` を以下の内容に**丸ごと置き換える**：

```python
"""
日本語フォントのダウンロード・キャッシュ。
GitHub Actions / macOS / Linux で同一コードで動作する。
"""
import urllib.request
from pathlib import Path

_FONTS_DIR = Path(__file__).parent / "fonts"

# Noto Sans JP（可変フォント）
_NOTO_JP_PATH = _FONTS_DIR / "NotoSansJP.ttf"
_NOTO_JP_URL = (
    "https://github.com/google/fonts/raw/main/ofl/notosansjp/"
    "NotoSansJP%5Bwght%5D.ttf"
)

# Zen Kaku Gothic Antique Bold（w番号・日付用）
_ZEN_KAKU_BOLD_PATH = _FONTS_DIR / "ZenKakuGothicAntique-Bold.ttf"
_ZEN_KAKU_BOLD_URL = (
    "https://github.com/google/fonts/raw/main/ofl/zenkakugothicantique/"
    "ZenKakuGothicAntique-Bold.ttf"
)

# Zen Antique Regular（見出し用）
_ZEN_ANTIQUE_PATH = _FONTS_DIR / "ZenAntique-Regular.ttf"
_ZEN_ANTIQUE_URL = (
    "https://github.com/google/fonts/raw/main/ofl/zenantique/"
    "ZenAntique-Regular.ttf"
)


def _fetch(url: str, path: Path) -> Path:
    if not path.exists():
        _FONTS_DIR.mkdir(exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path


def get_font_path() -> Path:
    """NotoSansJP フォントパスを返す（後方互換）。"""
    return _fetch(_NOTO_JP_URL, _NOTO_JP_PATH)


def get_zen_kaku_bold_path() -> Path:
    """Zen Kaku Gothic Antique Bold フォントパスを返す。"""
    return _fetch(_ZEN_KAKU_BOLD_URL, _ZEN_KAKU_BOLD_PATH)


def get_zen_antique_path() -> Path:
    """Zen Antique Regular フォントパスを返す。"""
    return _fetch(_ZEN_ANTIQUE_URL, _ZEN_ANTIQUE_PATH)
```

---

## タスク2: `weekly_magazine.py` の `_make_cover()` 完全書き換え

### 既存の `_make_cover()` を削除して以下に差し替える

```python
def _make_cover(
    image_bytes: bytes,
    issue_number: str,
    date_range: str,
    headline: str,
) -> bytes:
    """
    静的 PNG オーバーレイ（ICHIRO LIBRARY ロゴ）＋ Pillow 可変テキスト合成。
    AI 画像の輝度を判定し、黒または白テキストを自動選択する。
    """
    TEMPLATE_W, TEMPLATE_H = 1086, 1448
    OUT_W, OUT_H = 1024, 1536

    # スケール係数（テンプレート座標 → 出力画像座標）
    sx = OUT_W / TEMPLATE_W  # ≈ 0.943
    sy = OUT_H / TEMPLATE_H  # ≈ 1.061

    # ── 1. AI 生成画像を読み込み、出力サイズにリサイズ ─────────────────────
    base = Image.open(BytesIO(image_bytes)).convert("RGBA")
    base = base.resize((OUT_W, OUT_H), Image.LANCZOS)

    # ── 2. 輝度判定（上部 40% の平均輝度） ─────────────────────────────────
    top_region = base.crop((0, 0, OUT_W, int(OUT_H * 0.4)))
    gray = top_region.convert("L")
    pixels = list(gray.getdata())
    brightness = sum(pixels) / len(pixels)
    use_white = brightness < 128

    # ── 3. 静的オーバーレイ PNG の選択・合成 ────────────────────────────────
    ref_dir = Path(__file__).parent.parent.parent / "reference"
    overlay_name = "magazine_TEX_tmpW.png" if use_white else "ichiro-library-text.png"
    overlay = Image.open(ref_dir / overlay_name).convert("RGBA")
    overlay = overlay.resize((OUT_W, OUT_H), Image.LANCZOS)
    base = Image.alpha_composite(base, overlay)

    draw = ImageDraw.Draw(base)
    text_color = (255, 255, 255, 255) if use_white else (0, 0, 0, 255)

    # ── 4. フォント読み込み ──────────────────────────────────────────────────
    zen_kaku_path = str(get_zen_kaku_bold_path())
    zen_antique_path = str(get_zen_antique_path())

    # w番号フォントサイズ: テンプレートのバウンディングボックス高さ 64px × sy
    f_issue = ImageFont.truetype(zen_kaku_path, int(52 * sy))
    # 日付フォントサイズ: テンプレートのバウンディングボックス高さ 64px だが文字が小さい
    f_date = ImageFont.truetype(zen_kaku_path, int(28 * sy))
    # 見出しフォントサイズ: テンプレートのバウンディングボックス高さ 80px × sy
    f_headline = ImageFont.truetype(zen_antique_path, int(65 * sy))

    # ── 5. w番号（右寄せ、右端 x≈977） ─────────────────────────────────────
    right_x = int(1036 * sx)  # テンプレート右端 x=1036 をスケール
    top_y_issue = int(72 * sy)  # テンプレート y=72 をスケール

    issue_bbox = draw.textbbox((0, 0), issue_number, font=f_issue)
    issue_w = issue_bbox[2] - issue_bbox[0]
    draw.text(
        (right_x - issue_w, top_y_issue - issue_bbox[1]),
        issue_number,
        font=f_issue,
        fill=text_color,
    )

    # ── 6. 日付（右寄せ、w番号の下） ────────────────────────────────────────
    top_y_date = int(140 * sy)  # テンプレート y=140 をスケール

    date_bbox = draw.textbbox((0, 0), date_range, font=f_date)
    date_w = date_bbox[2] - date_bbox[0]
    draw.text(
        (right_x - date_w, top_y_date - date_bbox[1]),
        date_range,
        font=f_date,
        fill=text_color,
    )

    # ── 7. 見出し（左寄せ、折り返しあり） ──────────────────────────────────
    left_x = int(68 * sx)  # テンプレート x=68 をスケール
    top_y_headline = int(1296 * sy)  # テンプレート y=1296 をスケール
    max_text_w = int(350 * sx)  # テンプレート幅 350px をスケール（折り返し上限）

    def wrap_chars(text: str, font: ImageFont.FreeTypeFont) -> list[str]:
        lines, cur = [], ""
        for c in text:
            test = cur + c
            if draw.textlength(test, font=font) <= max_text_w:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = c
        if cur:
            lines.append(cur)
        return lines

    hl_lines = wrap_chars(headline, f_headline)
    line_gap = int(f_headline.size * 0.25)
    hl_h = f_headline.size + line_gap

    for i, line in enumerate(hl_lines):
        draw.text(
            (left_x, top_y_headline + i * hl_h),
            line,
            font=f_headline,
            fill=text_color,
        )

    # ── 8. 出力 ─────────────────────────────────────────────────────────────
    out = base.convert("RGB")
    buf = BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
```

### import 追加

`font_utils` の import 行を以下に更新（get_zen_kaku_bold_path・get_zen_antique_path を追加）：

```python
from font_utils import get_font_path, get_zen_kaku_bold_path, get_zen_antique_path
```

---

## タスク3: `generate_magazine()` の issue_display フォーマット変更

テンプレートのデザインに合わせ、w番号を `"w{N}"` 形式（小文字 w、週番号のみ）に変更する。

```python
# 変更前
issue_display = label.replace("-", "").replace("W", " W")  # "2026 W22" スタイル

# 変更後
week_num = int(monday.strftime("%W"))
issue_display = f"w{week_num}"  # "w22" スタイル（テンプレートに合わせる）
```

---

## 完了確認チェックリスト

- [ ] `font_utils.py` に `get_zen_kaku_bold_path()` と `get_zen_antique_path()` が追加されている
- [ ] `python -c "from font_utils import get_zen_kaku_bold_path, get_zen_antique_path; print(get_zen_kaku_bold_path()); print(get_zen_antique_path())"` でフォントが DL・キャッシュされる
- [ ] `weekly_magazine.py` の `_make_cover()` が上記の新実装に置き換わっている
- [ ] import 行に `get_zen_kaku_bold_path`, `get_zen_antique_path` が追加されている
- [ ] `issue_display` が `f"w{week_num}"` 形式になっている
- [ ] ローカルテスト実行（既存マガジンがある週の `cover_image_url` を NULL にしてから）:
  ```bash
  cd /Users/ikkiair/Projects/AI_work/03_personal_projects/ichiro-library/packages/pipeline
  python weekly_magazine.py --weeks-ago 1
  ```
- [ ] 生成された PNG を開き、ICHIRO LIBRARY が正しく合成されている
- [ ] w番号（例: `w22`）が右上に正しく描画されている
- [ ] 日付（例: `2026/06/09 – 06/15`）が w番号の下に右寄せで描画されている
- [ ] 見出しが左下に描画されている

---

## 重要な制約・注意事項

1. **Phase 6 で追加した `_make_cover()` の全コードを削除して**この実装に置き換える。NotoSansJP のグラデーション・バッジ描画ロジックは不要になる。
2. `get_font_path()` 関数は削除しない（他箇所で参照されている可能性があるため後方互換を維持）。
3. `reference/` フォルダへのパスは `Path(__file__).parent.parent.parent / "reference"` で解決する。
4. フォント URL が 404 の場合は、Google Fonts GitHub の最新パスを確認すること（URL は変更される場合がある）。
5. `set_variation_by_axes` の呼び出しは Zen フォントには不要（通常フォントのため）。

---

## 参照ファイル

- `reference/ichiro-library-text.png` — 黒テキスト静的オーバーレイ（明るい背景用）
- `reference/magazine_TEX_tmpW.png` — 白テキスト静的オーバーレイ（暗い背景用）
- `reference/magazine_TEX_tmp.png` — 全要素レイアウト参照（座標確認用）
