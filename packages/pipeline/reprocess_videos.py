"""
既存動画をAI再処理する（新プロンプトでsongs・talk_topics・corner_namesを更新）

使い方:
  python reprocess_videos.py                    # 全動画を再処理
  python reprocess_videos.py --no-summary-only  # 要約なし動画のみ（Gemini上限回復後のバックフィル用）
  python reprocess_videos.py --recent-first     # 最新配信から再処理
  python reprocess_videos.py --refetch          # snapshot があっても字幕を再取得
  python reprocess_videos.py --dry-run          # 確認のみ
  python reprocess_videos.py --video VIDEO_ID   # 特定動画のみ
"""

import sys
import time
import logging
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from get_transcript import TranscriptResult, get_transcript, build_timestamped_text
from summarize import get_gemini_client, summarize
from store import get_supabase_client, insert_chapters, save_transcript_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("reprocess")


def _join_snippet_text(snippets: list[dict]) -> str:
    return " ".join(
        (snippet.get("text") or "").strip()
        for snippet in snippets
        if (snippet.get("text") or "").strip()
    )


def _get_latest_transcript_snapshot(supabase, stream_id: str):
    rows = (
        supabase.table("transcript_snapshots")
        .select("id,source,snippets,captured_at")
        .eq("stream_id", stream_id)
        .order("captured_at", desc=True)
        .order("id", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None

    snapshot = rows[0]
    snippets = snapshot.get("snippets") or []
    if not isinstance(snippets, list) or not snippets:
        logger.warning(f"[{stream_id}] transcript_snapshot はあるが snippets が不正。再取得へフォールバック")
        return None

    return snapshot["id"], TranscriptResult(
        text=_join_snippet_text(snippets),
        snippets=snippets,
        source=snapshot.get("source") or "snapshot",
    )


def reprocess_one(
    supabase,
    gemini,
    row: dict,
    dry_run: bool,
    force: bool = False,
    refetch: bool = False,
):
    video_id = row["video_id"]
    stream_id = row["id"]
    transcript_text = row.get("transcript") or ""

    if row.get("is_reviewed") and not force:
        logger.info(f"[{video_id}] レビュー済みのため再処理をスキップ")
        return

    snapshot_id = None
    transcript_result = None

    if not refetch:
        try:
            latest_snapshot = _get_latest_transcript_snapshot(supabase, stream_id)
        except Exception as e:
            logger.warning(f"[{video_id}] snapshot 取得失敗。再取得へフォールバック: {e}")
            latest_snapshot = None

        if latest_snapshot:
            snapshot_id, transcript_result = latest_snapshot
            logger.info(f"[{video_id}] transcript_snapshot を再利用: {snapshot_id}")

    if transcript_result is None:
        transcript_result = get_transcript(video_id)

    if transcript_result.source == "failed" or not transcript_result.snippets:
        if not transcript_text:
            logger.warning(f"[{video_id}] 字幕なし、スキップ")
            return
        ai_result = summarize(transcript_text, model=gemini)
    else:
        timestamped_text = build_timestamped_text(transcript_result.snippets)
        if not timestamped_text:
            if not transcript_text:
                logger.warning(f"[{video_id}] 字幕テキスト空、スキップ")
                return
            ai_result = summarize(transcript_text, model=gemini)
        else:
            ai_result = summarize(timestamped_text, model=gemini)

    if not ai_result:
        logger.warning(f"[{video_id}] AI再処理失敗")
        return

    logger.info(f"[{video_id}] corner_names={ai_result.get('corner_names')} songs={ai_result.get('songs')} topics={ai_result.get('talk_topics')}")

    if dry_run:
        logger.info(f"[{video_id}] summary={ai_result.get('summary', '')[:60]}...")
        return

    if snapshot_id is None and transcript_result.source != "failed" and transcript_result.snippets:
        try:
            snapshot_id = save_transcript_snapshot(
                supabase,
                stream_id,
                transcript_result.source,
                transcript_result.snippets,
            )
        except Exception as e:
            logger.warning(f"[{video_id}] snapshot 保存失敗: {e}")
            snapshot_id = None

    supabase.table("streams").update({
        "summary":        ai_result.get("summary"),
        "tags":           ai_result.get("tags", []),
        "corner_names":   ai_result.get("corner_names", []),
        "guests":         ai_result.get("guests", []),
        "songs":          ai_result.get("songs", []),
        "talk_topics":    ai_result.get("talk_topics", []),
        "has_live_singing": ai_result.get("has_live_singing", False),
        "highlights":     ai_result.get("highlights", []),
        "ai_prompt_ver":  "v3",
    }).eq("video_id", video_id).execute()

    chapters = ai_result.get("chapters", [])
    if chapters:
        insert_chapters(supabase, stream_id, chapters, snapshot_id=snapshot_id)

    logger.info(f"[{video_id}] 更新完了")


def run(
    dry_run: bool = False,
    target_video_id: str = None,
    no_summary_only: bool = False,
    recent_first: bool = False,
    refetch: bool = False,
):
    supabase = get_supabase_client()
    gemini = get_gemini_client()

    query = supabase.table("streams").select("id,video_id,transcript,is_reviewed,status,stream_date")
    if target_video_id:
        query = query.eq("video_id", target_video_id)
    elif no_summary_only:
        query = query.is_("summary", "null")
        logger.info("モード: 要約なし動画のみ")

    rows = query.order("stream_date", desc=recent_first).execute().data or []

    total = len(rows)
    logger.info(f"再処理対象: {total}件")

    SKIP_IDS: list[str] = []  # 問題のある動画IDをここに追加

    for i, row in enumerate(rows):
        vid = row['video_id']
        if vid in SKIP_IDS:
            logger.info(f"--- {i + 1}/{total}件目: {vid} スキップ ---")
            continue
        logger.info(f"--- {i + 1}/{total}件目: {vid} ---")
        try:
            reprocess_one(
                supabase,
                gemini,
                row,
                dry_run,
                force=bool(target_video_id),
                refetch=refetch,
            )
        except Exception as e:
            logger.error(f"[{vid}] エラー: {e}", exc_info=True)
        if i < total - 1:
            time.sleep(5)

    logger.info("全件完了")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--video", type=str, help="特定の動画IDのみ再処理")
    parser.add_argument("--no-summary-only", action="store_true", help="要約なし動画のみ再処理（Gemini上限回復後のバックフィル用）")
    parser.add_argument("--recent-first", action="store_true", help="最新配信から再処理（7月リプロセス用）")
    parser.add_argument("--refetch", action="store_true", help="snapshot があっても字幕を再取得する")
    args = parser.parse_args()
    run(
        dry_run=args.dry_run,
        target_video_id=args.video,
        no_summary_only=args.no_summary_only,
        recent_first=args.recent_first,
        refetch=args.refetch,
    )
