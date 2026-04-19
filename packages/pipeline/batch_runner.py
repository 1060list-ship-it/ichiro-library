"""
バッチ実行スクリプト — 週次で新着動画を処理してSupabaseに登録する

使い方:
  python batch_runner.py                        # 通常実行（新着のみ・30日以内）
  python batch_runner.py --days 1095            # 3年分を遡って取得
  python batch_runner.py --max-videos 20        # 1回のバッチで最大20件まで処理
  python batch_runner.py --video VIDEO_ID       # 特定動画を強制処理（再処理用）
  python batch_runner.py --dry-run              # Supabaseへの書き込みを行わずログのみ出力

大量取り込み時の推奨手順:
  python batch_runner.py --days 1095 --max-videos 30
  # → 翌日も同じコマンドを実行。既処理分はスキップされ続きから再開する。
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

_INTER_VIDEO_SLEEP = 15   # 動画間の通常待機秒数
_ADAPTIVE_SLEEP_ADD = 10  # IPブロック発生後に追加する秒数（累積）


def process_video(video_meta: dict, gemini_model, supabase_client, dry_run: bool = False) -> bool:
    """処理成功したらTrue、字幕失敗はFalse"""
    video_id = video_meta["video_id"]
    logger.info(f"=== 処理開始: {video_id} / {video_meta.get('title', '')[:50]} ===")

    transcript_result = get_transcript(video_id)
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
        return transcript_result.source != "failed"

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
    return transcript_result.source != "failed"


def run_batch(dry_run: bool = False, days: int = 30, max_videos: int = 0):
    youtube = get_youtube_client()
    supabase = get_supabase_client()
    gemini = get_gemini_client()

    channel_id = get_channel_id(youtube)
    logger.info(f"チャンネルID: {channel_id}")

    existing_ids = get_existing_video_ids(supabase)
    logger.info(f"既存動画数: {len(existing_ids)}")

    published_after = datetime.now(timezone.utc) - timedelta(days=days)
    all_videos = fetch_live_archives(youtube, channel_id, published_after=published_after)
    new_videos = filter_new_videos(all_videos, existing_ids)

    if max_videos > 0:
        new_videos = new_videos[:max_videos]
        logger.info(f"新着動画数: {len(new_videos)}件（上限: {max_videos}件）")
    else:
        logger.info(f"新着動画数: {len(new_videos)}件")

    total = len(new_videos)
    if total == 0:
        logger.info("処理対象なし。終了します。")
        _update_week_old_views(youtube, supabase, dry_run)
        return

    consecutive_failures = 0
    current_sleep = _INTER_VIDEO_SLEEP

    for i, video_meta in enumerate(new_videos):
        logger.info(f"--- 進捗: {i + 1}/{total}件目 ---")
        try:
            success = process_video(video_meta, gemini, supabase, dry_run=dry_run)
            if not success:
                consecutive_failures += 1
                # 連続失敗が続くほどスリープを延ばす
                current_sleep = min(_INTER_VIDEO_SLEEP + consecutive_failures * _ADAPTIVE_SLEEP_ADD, 120)
                logger.info(f"連続失敗 {consecutive_failures}回 → 次の待機を{current_sleep}秒に調整")
            else:
                consecutive_failures = 0
                current_sleep = _INTER_VIDEO_SLEEP
        except Exception as e:
            logger.error(f"[{video_meta['video_id']}] 処理中にエラー: {e}", exc_info=True)
            consecutive_failures += 1

        if i < total - 1:
            logger.info(f"次の動画まで {current_sleep}秒待機...")
            time.sleep(current_sleep)

    logger.info(f"=== バッチ完了: {total}件処理 ===")
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
    parser.add_argument("--days", type=int, default=30, help="何日前まで遡るか（デフォルト: 30、3年分なら1095）")
    parser.add_argument("--max-videos", type=int, default=0, help="1回のバッチで処理する最大件数（0=無制限）")
    args = parser.parse_args()

    if args.video:
        run_single(args.video, dry_run=args.dry_run)
    else:
        run_batch(dry_run=args.dry_run, days=args.days, max_videos=args.max_videos)
