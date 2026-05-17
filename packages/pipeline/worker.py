"""
pipeline_jobs をポーリングして既存パイプラインを実行するワーカー。

使い方:
  python worker.py
  python worker.py --dry-run
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from batch_runner import run_batch
from reprocess_videos import run as run_reprocess
from store import get_supabase_client

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


def run_job(job: Dict[str, Any], dry_run: bool = False):
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
        run_reprocess(dry_run=dry_run)
        return

    if kind == "reprocess_single":
        if not video_id:
            raise ValueError("reprocess_single requires video_id")
        run_reprocess(dry_run=dry_run, target_video_id=video_id)
        return

    raise ValueError("Unknown job kind: %s" % kind)


def main(dry_run: bool = False) -> int:
    client = get_supabase_client()
    job = fetch_pending_job(client)

    if not job:
        logger.info("pending job not found")
        return 0

    if not mark_job_running(client, job["id"]):
        logger.info("job already claimed: %s", job["id"])
        return 0

    try:
        run_job(job, dry_run=dry_run)
        mark_job_done(client, job["id"])
        logger.info("job done: %s", job["id"])
        return 0
    except Exception as exc:
        logger.exception("job failed: %s", job["id"])
        mark_job_failed(client, job["id"], str(exc))
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ichiro-library pipeline worker")
    parser.add_argument("--dry-run", action="store_true", help="外部書き込みを行わず処理を確認する")
    args = parser.parse_args()
    raise SystemExit(main(dry_run=args.dry_run))
