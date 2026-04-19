"""
既存動画のいいね数をYouTube APIで取得してSupabaseを更新する

使い方:
  python update_likes.py           # 全動画を更新
  python update_likes.py --dry-run # 確認のみ
"""

import sys
import logging
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from fetch_new_videos import get_youtube_client, _fetch_video_details
from store import get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("update_likes")


def run(dry_run: bool = False):
    youtube = get_youtube_client()
    supabase = get_supabase_client()

    resp = supabase.table("streams").select("video_id").execute()
    video_ids = [r["video_id"] for r in (resp.data or [])]
    logger.info(f"対象動画数: {len(video_ids)}件")

    # YouTube APIは1リクエスト最大50件
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i+50]
        details = _fetch_video_details(youtube, chunk)
        for meta in details:
            like_count = meta.get("like_count")
            logger.info(f"[{meta['video_id']}] like_count={like_count}")
            if not dry_run and like_count is not None:
                supabase.table("streams").update(
                    {"like_count": like_count}
                ).eq("video_id", meta["video_id"]).execute()

    logger.info("完了")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
