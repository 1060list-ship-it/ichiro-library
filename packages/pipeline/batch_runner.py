"""
バッチ実行スクリプト — 週次で新着動画を処理してSupabaseに登録する

使い方:
  python batch_runner.py               # 通常実行（新着のみ処理）
  python batch_runner.py --video VIDEO_ID  # 特定動画を強制処理（再処理用）
  python batch_runner.py --dry-run     # Supabaseへの書き込みを行わずログのみ出力
"""

import os
import sys
import time
import logging
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv

# プロジェクトルートの .env.local を読み込む
load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from fetch_new_videos import get_youtube_client, get_channel_id, fetch_live_archives, filter_new_videos, _fetch_video_details
from get_transcript import get_transcript, build_timestamped_text
from summarize import get_gemini_client, summarize
from store import get_supabase_client, get_existing_video_ids, upsert_stream, insert_chapters, update_view_count_7d

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("batch_runner")


def process_video(video_meta: dict, gemini_model, supabase_client, dry_run: bool = False):
    video_id = video_meta["video_id"]
    logger.info(f"=== 処理開始: {video_id} / {video_meta.get('title', '')[:50]} ===")

    # 字幕取得
    transcript_result = get_transcript(video_id)

    # タイムスタンプ付きテキストを生成してGeminiに渡す
    timestamped_text = build_timestamped_text(transcript_result.snippets)
    ai_result = None

    if transcript_result.source != "failed" and timestamped_text:
        ai_result = summarize(timestamped_text, model=gemini_model)
    else:
        logger.warning(f"[{video_id}] 字幕なしのためAI要約をスキップ")

    if dry_run:
        logger.info(f"[DRY RUN] {video_id} の書き込みをスキップ")
        logger.info(f"  transcript_source: {transcript_result.source}")
        logger.info(f"  ai_result keys: {list(ai_result.keys()) if ai_result else None}")
        return

    # Supabaseに登録
    stream_id = upsert_stream(
        client=supabase_client,
        video_meta=video_meta,
        transcript_text=transcript_result.text,
        transcript_source=transcript_result.source,
        ai_result=ai_result,
    )

    if ai_result and ai_result.get("chapters"):
        insert_chapters(supabase_client, stream_id, ai_result["chapters"])

    logger.info(f"=== 処理完了: {video_id} ===")


def run_batch(dry_run: bool = False):
    youtube = get_youtube_client()
    supabase = get_supabase_client()
    gemini = get_gemini_client()

    channel_id = get_channel_id(youtube)
    logger.info(f"チャンネルID: {channel_id}")

    existing_ids = get_existing_video_ids(supabase)
    logger.info(f"既存動画数: {len(existing_ids)}")

    # 30日前以降の動画を取得（初回は広めに取る）
    published_after = datetime.now(timezone.utc) - timedelta(days=30)
    all_videos = fetch_live_archives(youtube, channel_id, published_after=published_after)
    new_videos = filter_new_videos(all_videos, existing_ids)
    logger.info(f"新着動画数: {len(new_videos)}")

    for i, video_meta in enumerate(new_videos):
        try:
            process_video(video_meta, gemini, supabase, dry_run=dry_run)
        except Exception as e:
            logger.error(f"[{video_meta['video_id']}] 処理中にエラー: {e}", exc_info=True)
        if i < len(new_videos) - 1:
            time.sleep(5)  # YouTubeのIP制限を避けるため動画間に5秒待機

    # 7日前の動画の view_count_7d を更新
    _update_week_old_views(youtube, supabase, dry_run)


def _update_week_old_views(youtube, supabase, dry_run: bool):
    target_date = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    resp = supabase.table("streams").select("video_id").eq("stream_date", target_date).is_("view_count_7d", "null").execute()
    targets = resp.data or []

    if not targets:
        logger.info("view_count_7d 更新対象なし")
        return

    video_ids = [r["video_id"] for r in targets]
    details = _fetch_video_details(youtube, video_ids)

    for meta in details:
        if dry_run:
            logger.info(f"[DRY RUN] view_count_7d 更新スキップ: {meta['video_id']}")
        else:
            update_view_count_7d(supabase, meta)


def run_single(video_id: str, dry_run: bool = False):
    youtube = get_youtube_client()
    supabase = get_supabase_client()
    gemini = get_gemini_client()

    details = _fetch_video_details(youtube, [video_id])
    if not details:
        logger.error(f"動画が見つかりません: {video_id}")
        return

    process_video(details[0], gemini, supabase, dry_run=dry_run)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ichiro-library バッチ処理")
    parser.add_argument("--video", type=str, help="特定の動画IDを処理（再処理用）")
    parser.add_argument("--dry-run", action="store_true", help="Supabaseへの書き込みを行わない")
    args = parser.parse_args()

    if args.video:
        run_single(args.video, dry_run=args.dry_run)
    else:
        run_batch(dry_run=args.dry_run)
