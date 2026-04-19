"""
既存動画をAI再処理する（新プロンプトでsongs・talk_topics・corner_namesを更新）

使い方:
  python reprocess_videos.py           # 全動画を再処理
  python reprocess_videos.py --dry-run # 確認のみ
  python reprocess_videos.py --video VIDEO_ID  # 特定動画のみ
"""

import sys
import time
import logging
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from get_transcript import get_transcript, build_timestamped_text
from summarize import get_gemini_client, summarize
from store import get_supabase_client, insert_chapters

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("reprocess")


def reprocess_one(supabase, gemini, row: dict, dry_run: bool):
    video_id = row["video_id"]
    stream_id = row["id"]
    transcript_text = row.get("transcript") or ""

    if not transcript_text:
        logger.warning(f"[{video_id}] 字幕なし、スキップ")
        return

    # タイムスタンプ付きテキストに変換できないのでそのまま渡す
    # 既存データはスニペット形式ではなくプレーンテキストで保存されているため
    ai_result = summarize(transcript_text, model=gemini)
    if not ai_result:
        logger.warning(f"[{video_id}] AI再処理失敗")
        return

    logger.info(f"[{video_id}] corner_names={ai_result.get('corner_names')} songs={ai_result.get('songs')} topics={ai_result.get('talk_topics')}")

    if dry_run:
        return

    supabase.table("streams").update({
        "summary":      ai_result.get("summary"),
        "tags":         ai_result.get("tags", []),
        "corner_names": ai_result.get("corner_names", []),
        "guests":       ai_result.get("guests", []),
        "songs":        ai_result.get("songs", []),
        "talk_topics":  ai_result.get("talk_topics", []),
        "ai_prompt_ver": "v1",
    }).eq("video_id", video_id).execute()

    chapters = ai_result.get("chapters", [])
    if chapters:
        insert_chapters(supabase, stream_id, chapters)

    logger.info(f"[{video_id}] 更新完了")


def run(dry_run: bool = False, target_video_id: str = None):
    supabase = get_supabase_client()
    gemini = get_gemini_client()

    if target_video_id:
        resp = supabase.table("streams").select("*").eq("video_id", target_video_id).execute()
    else:
        resp = supabase.table("streams").select("*").execute()

    rows = resp.data or []
    total = len(rows)
    logger.info(f"再処理対象: {total}件")

    for i, row in enumerate(rows):
        logger.info(f"--- {i + 1}/{total}件目: {row['video_id']} ---")
        try:
            reprocess_one(supabase, gemini, row, dry_run)
        except Exception as e:
            logger.error(f"[{row['video_id']}] エラー: {e}", exc_info=True)
        if i < total - 1:
            time.sleep(5)

    logger.info("全件完了")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--video", type=str, help="特定の動画IDのみ再処理")
    args = parser.parse_args()
    run(dry_run=args.dry_run, target_video_id=args.video)
