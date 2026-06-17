"""
週刊マガジン生成スクリプト
指定した週（デフォルト: 直近の月〜日）の配信を束ねてGeminiでマガジン記事を生成し、
magazinesテーブルに保存する。
"""

import os
import re
import sys
import json
import base64
import logging
import argparse
from datetime import date, timedelta
from pathlib import Path
from typing import Optional
from io import BytesIO

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env.local")

from PIL import Image, ImageDraw, ImageFont
from openai import OpenAI
from supabase import create_client
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from extract_entities import find_entity_ids, load_entities, magazine_text, save_magazine_entities
from fetch_media_news import fetch_media_news
from font_utils import get_font_path, get_zen_kaku_bold_path, get_zen_antique_path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("weekly_magazine")

MODEL_NAME = "gemini-2.5-flash"
IMAGE_MODEL = "gpt-image-2"
IMAGE_SIZE  = "1024x1536"
STORAGE_BUCKET = "magazine-covers"

COVER_PROMPT_TEMPLATE = """You are an art director for a Japanese weekly music editorial platform called "いっくん追いかけマガジン".
Generate a weekly vertical editorial image for a UI hero slot; all typography will be composited externally after generation.

Output ONLY the English image prompt text (max 80 words). No explanations, no labels, no code blocks, no Japanese.

FIXED STYLE (always include ALL of these in your output prompt):
- vertical Japanese editorial artwork, 2:3 portrait format, pure visual illustration — no text zones
- upper 35% of the composition must be a minimal, nearly-empty tonal field (dark sky, fog, blank paper, or flat wash only) — no detailed elements, figures, or patterns in that zone; this area will be covered by title text
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

MAGAZINE_PROMPT = """あなたは「いっくん追いかけマガジン」の編集者です。
山口一郎（サカナクション）のYouTubeライブ配信を追えないファンのために、1週間分の配信内容をマガジン形式でまとめてください。

## 入力データ
以下は{week_label}（{week_start}〜{week_end}）の配信情報です。

### 今週の配信一覧
{streams_json}

### 今週の外部メディア情報（Google News・setlist.fm）
{media_news_json}

### 前週のコンテキスト（参考）
{prev_context}

## タスク
以下の構造でJSONを返してください。JSONのみ、マークダウンのコードブロック不要。

{{
  "headline": "今週を一言で表すキャッチコピー（30字以内）",
  "intro": "今週全体をライブレポートとして300〜500字で書く。箇条書き不要、流れる文章（段落分け可）。この週の一郎の雰囲気・話し方・印象的な場面を盛り込み、配信を見ていない読者が『どんな一週間だったか』感じ取れる粒度にする。前週からのつながりがあれば自然に言及する",
  "topics": [
    {{
      "title": "トピックタイトル（20字以内）",
      "body": "そのトピックの詳細を200〜350字で書く。箇条書き不要、流れる文章で。複数の配信にまたがる場合は統合し、一郎の発言・雰囲気・会話の流れを盛り込みながら読み物として仕上げる",
      "streams": [
        {{
          "video_id": "動画ID",
          "title": "配信タイトル",
          "start_sec": null
        }}
      ]
    }}
  ],
  "guests": ["今週登場したゲスト名"],
  "songs": [
    {{"title": "曲名", "video_id": "その曲が流れた動画のID"}}
  ],
  "highlights": [
    {{
      "video_id": "動画ID",
      "quote": "発言の引用（50字以内）",
      "reason": "盛り上がりの種別（笑い・名言・感動・驚き・神回のいずれか）",
      "start_sec": 開始秒数（整数）
    }}
  ],
  "editor_note": "次週へのひとこと・期待感（50〜100字）"
}}

## 注意
- topicsは大きなテーマ単位で2〜5個にまとめること（配信1本=1トピックにしない）
- highlightsは今週全体から特に印象的な3〜5個を選ぶ
- 前週コンテキストは参考情報として使い、今週の話題を中心に書く
- songsは曲名の重複を排除すること。同じ曲が複数配信で流れた場合は最初に登場した配信のvideo_idを採用する
- 外部メディア情報がある場合はtopicsに自然に統合すること（「ニュースによると」等の引用形式は不要、ファクトとして使う）
- ライブセットリスト情報（setlist.fm）があれば songsセクションに加える（ただし配信で流れた曲と重複排除すること）
- 外部情報が少ない or 関連性が薄い場合は無理に使わなくてよい
"""


def get_week_range(target_date: date):
    """指定日が含まれる週の月曜〜日曜を返す"""
    monday = target_date - timedelta(days=target_date.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def week_label(monday: date) -> str:
    return monday.strftime("%Y-W%W")


@retry(
    retry=retry_if_exception_type(Exception),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    stop=stop_after_attempt(3),
    reraise=True,
)
def _generate(client, prompt: str) -> str:
    response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
    return response.text.strip()


def _mood_from_highlights(highlights: list) -> str:
    from collections import Counter
    reasons = [h.get("reason", "") for h in highlights if h.get("reason")]
    if not reasons:
        return "balanced"
    most_common = Counter(reasons).most_common(1)[0][0]
    mapping = {"笑い": "lighthearted and fun", "名言": "thoughtful and inspiring",
               "感動": "emotional and moving", "驚き": "surprising and energetic", "神回": "legendary and epic"}
    return mapping.get(most_common, "balanced")


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

    # ── 3.5. 上部グラデーション（タイトルエリアを確保） ─────────────────────────
    # "ICHIRO LIBRARY" テキストが重なる上部約30%をグラデで薄め、
    # 文字が背景に埋もれないようにする
    top_fade_end = int(OUT_H * 0.30)
    gc = (0, 0, 0) if use_white else (255, 255, 255)
    top_gradient = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    top_grad_draw = ImageDraw.Draw(top_gradient)
    for y in range(0, top_fade_end):
        alpha = int(160 * (top_fade_end - y) / top_fade_end)
        top_grad_draw.line([(0, y), (OUT_W, y)], fill=(*gc, alpha))
    base = Image.alpha_composite(base, top_gradient)

    # ── 3.6. 底部グラデーション（AI生成テキストをマスク） ──────────────────────
    # 見出しテキスト描画エリア（下部約22%）を半透明グラデで覆い、
    # gpt-image-2 が生成した日本語テキスト等を視覚的に隠す
    grad_top = int(OUT_H * 0.78)
    bottom_gradient = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(bottom_gradient)
    for y in range(grad_top, OUT_H):
        alpha = int(200 * (y - grad_top) / (OUT_H - grad_top))
        grad_draw.line([(0, y), (OUT_W, y)], fill=(*gc, alpha))
    base = Image.alpha_composite(base, bottom_gradient)

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


def generate_cover_image(
    client, content: dict, label: str, sb,
    monday: date, sunday: date,
) -> Optional[str]:
    try:
        all_highlights = content.get("highlights", [])
        mood = _mood_from_highlights(all_highlights)
        topics = ", ".join(t["title"] for t in content.get("topics", []))
        songs_raw = content.get("songs", [])[:5]
        songs = ", ".join(
            (s.get("title", "") if isinstance(s, dict) else str(s))
            for s in songs_raw
        )

        cover_prompt_request = COVER_PROMPT_TEMPLATE.format(
            headline=content.get("headline", ""),
            topics=topics,
            songs=songs,
            mood=mood,
        )

        logger.info(f"[{label}] カバープロンプト生成中...")
        prompt_response = _generate(client, cover_prompt_request)
        logger.info(f"[{label}] Gemini raw prompt: {prompt_response.strip()[:100]}...")
        image_prompt = _sanitize_cover_prompt(prompt_response, label)
        logger.info(f"[{label}] 画像プロンプト: {image_prompt[:80]}...")

        logger.info(f"[{label}] カバー画像生成中 (gpt-image-2)...")
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
        )
        image_bytes = base64.b64decode(image_response.data[0].b64_json)

        date_range = f"{monday.strftime('%Y/%m/%d')} – {sunday.strftime('%m/%d')}"
        week_num = int(monday.strftime("%W"))
        issue_display = f"w{week_num}"
        image_bytes = _make_cover(image_bytes, issue_display, date_range, content.get("headline", ""))

        file_path = f"{label}.png"
        sb.storage.from_(STORAGE_BUCKET).upload(
            path=file_path,
            file=image_bytes,
            file_options={"content-type": "image/png", "upsert": "true"},
        )
        public_url = sb.storage.from_(STORAGE_BUCKET).get_public_url(file_path)
        logger.info(f"[{label}] カバー画像アップロード完了: {public_url}")

        sb.table("magazines").update({
            "cover_image_url": public_url,
            "cover_prompt": image_prompt,
            "cover_generated_at": "now()",
        }).eq("week_label", label).execute()

        return public_url

    except Exception as e:
        logger.error(f"[{label}] カバー画像生成失敗（マガジン本体は保存済み）: {e}")
        return None


def generate_magazine(target_date: date = None):
    if target_date is None:
        target_date = date.today() - timedelta(days=1)

    monday, sunday = get_week_range(target_date)
    label = week_label(monday)

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    # 既存チェック — 再生成が必要な場合は workflow_dispatch で手動実行
    existing = sb.table("magazines").select("id").eq("week_label", label).execute()
    if existing.data:
        logger.info(f"[{label}] 既存のマガジンがあります。スキップします（再生成は workflow_dispatch で）")
        return

    # 字幕完備チェック — transcript_failed があれば中断
    failed_streams = sb.table("streams").select("video_id, title").eq("status", "transcript_failed") \
        .gte("stream_date", monday.isoformat()).lte("stream_date", sunday.isoformat()).execute()
    if failed_streams.data:
        titles = [f"  - {s['title'][:60]} ({s['video_id']})" for s in failed_streams.data]
        logger.error(f"[{label}] 字幕未取得の配信があるためマガジン発行を中断:\n" + "\n".join(titles))
        logger.error(f"[{label}] 該当動画の字幕を取得後、再度実行してください")
        sys.exit(1)

    # 今週の配信を取得
    # started_at カラムは migration 009 適用後に有効。未適用時は stream_date でフォールバック
    try:
        streams_res = sb.table("streams").select(
            "id, video_id, title, stream_date, started_at, summary, tags, corner_names, guests, songs, highlights, talk_topics"
        ).gte("stream_date", monday.isoformat()).lte("stream_date", sunday.isoformat()).order("started_at", nullsfirst=False).execute()
    except Exception:
        streams_res = sb.table("streams").select(
            "id, video_id, title, stream_date, summary, tags, corner_names, guests, songs, highlights, talk_topics"
        ).gte("stream_date", monday.isoformat()).lte("stream_date", sunday.isoformat()).order("stream_date").execute()

    streams = streams_res.data
    if not streams:
        logger.warning(f"[{label}] 配信が0件のためスキップ")
        return

    logger.info(f"[{label}] 配信 {len(streams)} 件を処理")

    # 外部メディア情報を取得
    try:
        media_mentions = fetch_media_news(monday, sunday)
        logger.info(f"[{label}] 外部メディア情報 {len(media_mentions)} 件取得")
    except Exception as e:
        logger.warning(f"[{label}] 外部メディア情報取得失敗（スキップ）: {e}")
        media_mentions = []

    media_news_json = json.dumps(media_mentions, ensure_ascii=False, indent=2) if media_mentions else "（今週は外部メディア情報なし）"

    # 前週のコンテキストを取得
    prev_monday = monday - timedelta(days=7)
    prev_label = week_label(prev_monday)
    prev_res = sb.table("magazines").select("content").eq("week_label", prev_label).execute()
    if prev_res.data:
        prev_content = prev_res.data[0]["content"]
        prev_context = f"前週（{prev_label}）のまとめ：{prev_content.get('intro', '')}\n主なトピック：{', '.join(t['title'] for t in prev_content.get('topics', []))}"
    else:
        prev_context = "前週のデータなし"

    # Gemini呼び出し
    streams_summary = []
    for s in streams:
        streams_summary.append({
            "video_id": s["video_id"],
            "title": s["title"],
            "date": s["stream_date"],
            "started_at": s.get("started_at", ""),
            "summary": s["summary"] or "",
            "corner_names": s.get("corner_names") or [],
            "guests": s.get("guests") or [],
            "songs": s.get("songs") or [],
            "talk_topics": s.get("talk_topics") or [],
            "highlights": s.get("highlights") or [],
        })

    prompt = MAGAZINE_PROMPT.format(
        week_label=label,
        week_start=monday.isoformat(),
        week_end=sunday.isoformat(),
        streams_json=json.dumps(streams_summary, ensure_ascii=False, indent=2),
        media_news_json=media_news_json,
        prev_context=prev_context,
    )

    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)

    logger.info(f"[{label}] Gemini 生成中...")
    raw = _generate(client, prompt)

    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if m:
        raw = m.group(1).strip()

    content = json.loads(raw)
    logger.info(f"[{label}] 生成完了: topics={len(content.get('topics', []))}, highlights={len(content.get('highlights', []))}")

    stream_ids = [s["id"] for s in streams]

    if existing.data:
        sb.table("magazines").update({
            "content": content,
            "stream_ids": stream_ids,
            "generated_at": "now()",
        }).eq("week_label", label).execute()
    else:
        # 号数は連番ではなく week_label（例: 2026-W19）を安定IDとして扱う。
        # 過去週をバックフィルしても番号がずれないよう、issue_number は採番しない。
        insert_row = {
            "week_label": label,
            "week_start": monday.isoformat(),
            "week_end": sunday.isoformat(),
            "content": content,
            "stream_ids": stream_ids,
        }
        sb.table("magazines").insert(insert_row).execute()

    logger.info(f"[{label}] magazinesテーブルに保存完了")

    try:
        mag_res = sb.table("magazines").select("id, content").eq("week_label", label).single().execute()
        entities = load_entities(sb)
        entity_ids = find_entity_ids(magazine_text(mag_res.data), entities)
        count = save_magazine_entities(sb, mag_res.data["id"], entity_ids)
        logger.info(f"[{label}] magazine_entities 保存完了: {count}件")
    except Exception as e:
        logger.warning(f"[{label}] magazine_entities 保存をスキップ: {e}")

    generate_cover_image(client, content, label, sb, monday, sunday)

    return content


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="処理対象の日付 YYYY-MM-DD（デフォルト: 昨日）")
    parser.add_argument("--weeks-ago", type=int, default=0, help="何週前を処理するか")
    args = parser.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
    else:
        target = date.today() - timedelta(days=1 + args.weeks_ago * 7)

    generate_magazine(target)
