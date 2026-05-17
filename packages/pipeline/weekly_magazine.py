"""
週刊マガジン生成スクリプト
指定した週（デフォルト: 直近の月〜日）の配信を束ねてGeminiでマガジン記事を生成し、
magazinesテーブルに保存する。
"""

import os
import re
import json
import logging
import argparse
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env.local")

from supabase import create_client
from google import genai
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("weekly_magazine")

MODEL_NAME = "gemini-2.5-flash"

MAGAZINE_PROMPT = """あなたは「いっくん追いかけマガジン」の編集者です。
山口一郎（サカナクション）のYouTubeライブ配信を追えないファンのために、1週間分の配信内容をマガジン形式でまとめてください。

## 入力データ
以下は{week_label}（{week_start}〜{week_end}）の配信情報です。

### 今週の配信一覧
{streams_json}

### 前週のコンテキスト（参考）
{prev_context}

## タスク
以下の構造でJSONを返してください。JSONのみ、マークダウンのコードブロック不要。

{{
  "headline": "今週を一言で表すキャッチコピー（30字以内）",
  "intro": "今週全体の雰囲気・流れをまとめた導入文（150〜250字）。前週からのつながりがあれば言及する",
  "topics": [
    {{
      "title": "トピックタイトル（20字以内）",
      "body": "そのトピックの詳細（100〜200字）。複数の配信にまたがる場合は統合して書く",
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
  "songs": ["今週流れた・解説された楽曲名（重複なし）"],
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


def generate_magazine(target_date: date = None):
    if target_date is None:
        target_date = date.today() - timedelta(days=1)

    monday, sunday = get_week_range(target_date)
    label = week_label(monday)

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    # 既存チェック
    existing = sb.table("magazines").select("id").eq("week_label", label).execute()
    if existing.data:
        logger.info(f"[{label}] 既存のマガジンがあります。上書きします")

    # 今週の配信を取得
    streams_res = sb.table("streams").select(
        "id, video_id, title, stream_date, summary, tags, corner_names, guests, songs, highlights, talk_topics"
    ).gte("stream_date", monday.isoformat()).lte("stream_date", sunday.isoformat()).order("stream_date").execute()

    streams = streams_res.data
    if not streams:
        logger.warning(f"[{label}] 配信が0件のためスキップ")
        return

    logger.info(f"[{label}] 配信 {len(streams)} 件を処理")

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
        sb.table("magazines").insert({
            "week_label": label,
            "week_start": monday.isoformat(),
            "week_end": sunday.isoformat(),
            "content": content,
            "stream_ids": stream_ids,
        }).execute()

    logger.info(f"[{label}] magazinesテーブルに保存完了")
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
