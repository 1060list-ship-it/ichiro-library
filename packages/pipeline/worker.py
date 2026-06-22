"""
pipeline_jobs をポーリングして既存パイプラインを実行するワーカー。

使い方:
  python worker.py
  python worker.py --dry-run
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from batch_runner import run_batch
from reprocess_videos import run as run_reprocess
from store import get_supabase_client
from weekly_magazine import generate_magazine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("pipeline_worker")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_pending_job(client) -> Optional[Dict[str, Any]]:
    resp = (
        client.table("pipeline_jobs")
        .select("*")
        .eq("status", "pending")
        .order("requested_at")
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def mark_job_running(client, job_id: str) -> bool:
    resp = (
        client.table("pipeline_jobs")
        .update(
            {
                "status": "running",
                "started_at": utc_now_iso(),
                "error_msg": None,
            }
        )
        .eq("id", job_id)
        .eq("status", "pending")
        .execute()
    )
    return bool(resp.data)


def mark_job_done(client, job_id: str):
    (
        client.table("pipeline_jobs")
        .update(
            {
                "status": "done",
                "finished_at": utc_now_iso(),
                "error_msg": None,
            }
        )
        .eq("id", job_id)
        .execute()
    )


def mark_job_failed(client, job_id: str, error_msg: str):
    (
        client.table("pipeline_jobs")
        .update(
            {
                "status": "failed",
                "error_msg": error_msg,
                "finished_at": utc_now_iso(),
            }
        )
        .eq("id", job_id)
        .execute()
    )


def run_job(client, job: Dict[str, Any], dry_run: bool = False):
    kind = job["kind"]
    payload = job.get("payload") or {}
    video_id = job.get("video_id")

    logger.info("job start: id=%s kind=%s", job["id"], kind)

    if kind == "fetch_new":
        run_batch(
            dry_run=dry_run,
            days=int(payload.get("days", 30)),
            max_videos=int(payload.get("max_videos", 20)),
        )
        return

    if kind == "reprocess":
        recent_first = bool(payload.get("recent_first", False))
        run_reprocess(dry_run=dry_run, recent_first=recent_first)
        return

    if kind == "reprocess_single":
        if not video_id:
            raise ValueError("reprocess_single requires video_id")
        run_reprocess(dry_run=dry_run, target_video_id=video_id)
        return

    if kind == "whisper_transcribe":
        from whisper_transcribe import transcribe_and_store
        if not video_id:
            raise ValueError("whisper_transcribe requires video_id")
        transcribe_and_store(client, video_id, dry_run=dry_run)
        return

    if kind == "weekly_magazine":
        from datetime import date as _date
        target_str = payload.get("date")
        target = _date.fromisoformat(target_str) if target_str else None
        if dry_run:
            logger.info("dry-run: weekly_magazine generation skipped")
            return
        generate_magazine(target_date=target)
        return

    raise ValueError("Unknown job kind: %s" % kind)


def write_status_file(client) -> None:
    """Supabase の最新状態を 10_system/status/ichiro_status.md に書き出す。"""
    repo_root = Path(__file__).parent.parent.parent.parent.parent  # ichiro-library → 03_personal_projects → AI_work
    # fallback: 環境変数があればそちらを優先
    ai_work = Path(os.environ.get("AI_WORK_REPO", str(repo_root)))
    status_dir = ai_work / "10_system" / "status"
    status_dir.mkdir(parents=True, exist_ok=True)
    status_path = status_dir / "ichiro_status.md"

    now = datetime.now(timezone.utc)
    seven_days_ago = (now - timedelta(days=7)).date().isoformat()

    try:
        total_resp = client.table("streams").select("video_id", count="exact").execute()
        total = total_resp.count or 0

        latest_resp = (
            client.table("streams")
            .select("title,stream_date,status")
            .order("stream_date", desc=True)
            .limit(1)
            .execute()
        )
        latest = latest_resp.data[0] if latest_resp.data else None

        failed_resp = (
            client.table("streams")
            .select("video_id,title,stream_date")
            .eq("status", "transcript_failed")
            .gte("stream_date", seven_days_ago)
            .order("stream_date", desc=True)
            .execute()
        )
        failed = failed_resp.data or []

        mag_resp = (
            client.table("magazines")
            .select("week_label,created_at")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest_mag = mag_resp.data[0] if mag_resp.data else None

        # 次回発行予定週（金曜実行 → 昨日=木曜の週 = %W ベース）
        from datetime import date as _date
        next_friday = _date.today() + timedelta(days=(4 - _date.today().weekday()) % 7 or 7)
        next_target = next_friday - timedelta(days=1)
        next_monday = next_target - timedelta(days=next_target.weekday())
        next_week_label = next_monday.strftime("%Y-W%W")

        lines = [
            f"# ichiro-library ステータス\n",
            f"\n更新: {now.strftime('%Y-%m-%d %H:%M')} UTC\n\n",
            f"- 総動画数: {total}件\n",
        ]
        if latest:
            lines.append(f"- 最終取り込み: {latest['stream_date']} 「{latest['title'][:30]}…」 ({latest['status']})\n")
        if latest_mag:
            lines.append(f"- 最新マガジン: {latest_mag['week_label']}（発行済み）\n")
            lines.append(f"- 次回マガジン: {next_week_label}（毎週金曜 07:00 JST 自動発行）\n")

        if failed:
            lines.append(f"\n## 要対応: transcript_failed（直近7日）\n\n")
            for v in failed:
                lines.append(f"- {v['stream_date']} `{v['video_id']}` {v['title'][:40]}\n")
            lines.append(f"\n再処理コマンド:\n")
            lines.append(f"```\ncd packages/pipeline\n")
            for v in failed:
                lines.append(f"python batch_runner.py --video {v['video_id']}\n")
            lines.append("```\n")
        else:
            lines.append("- transcript_failed: 直近7日なし\n")

        status_path.write_text("".join(lines), encoding="utf-8")
        logger.info("ichiro status file updated: %s", status_path)

    except Exception as exc:
        logger.warning("status file write failed: %s", exc)


def main(dry_run: bool = False) -> int:
    client = get_supabase_client()
    job = fetch_pending_job(client)

    if not job:
        logger.info("pending job not found")
        write_status_file(client)
        return 0

    if not mark_job_running(client, job["id"]):
        logger.info("job already claimed: %s", job["id"])
        return 0

    try:
        run_job(client, job, dry_run=dry_run)
        mark_job_done(client, job["id"])
        logger.info("job done: %s", job["id"])
    except Exception as exc:
        logger.exception("job failed: %s", job["id"])
        mark_job_failed(client, job["id"], str(exc))
        write_status_file(client)
        return 1

    write_status_file(client)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ichiro-library pipeline worker")
    parser.add_argument("--dry-run", action="store_true", help="外部書き込みを行わず処理を確認する")
    args = parser.parse_args()
    raise SystemExit(main(dry_run=args.dry_run))
