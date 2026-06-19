"""
マガジンバックフィルスクリプト
streams にあるが magazines がまだない週を検出して自動生成する。

使い方:
  python backfill_magazines.py              # 未生成週を全件処理（古い順）
  python backfill_magazines.py --max-weeks 5  # 1回5週まで処理
  python backfill_magazines.py --dry-run    # 対象週の一覧だけ表示

動画バッチと組み合わせた推奨手順:
  python batch_runner.py --days 1095 --max-videos 30
  python backfill_magazines.py --max-weeks 5
  # → 翌日も同じコマンドを実行。既処理分はスキップされ続きから再開する。
"""

import os
import sys
import subprocess
import logging
import argparse
from datetime import date, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from store import get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("backfill_magazines")


def _to_monday(date_str: str) -> date:
    d = date.fromisoformat(date_str)
    return d - timedelta(days=d.weekday())


def get_missing_weeks(supabase) -> list[date]:
    """streams にあるが magazines にない週月曜日を古い順で返す"""
    streams_res = supabase.from_("streams").select("stream_date").execute()
    if not streams_res.data:
        logger.info("streams が 0 件です")
        return []

    stream_weeks = {_to_monday(r["stream_date"]) for r in streams_res.data}

    mag_res = supabase.from_("magazines").select("week_start").execute()
    magazine_weeks = {date.fromisoformat(r["week_start"]) for r in (mag_res.data or [])}

    missing = sorted(stream_weeks - magazine_weeks)
    return missing


def run_backfill(max_weeks: int = 0, dry_run: bool = False):
    supabase = get_supabase_client()
    missing = get_missing_weeks(supabase)

    logger.info(f"マガジン未生成の週: {len(missing)} 件")
    for w in missing:
        logger.info(f"  未生成: {w.isoformat()}")

    if dry_run:
        logger.info("[DRY RUN] 実際の生成は行いません")
        return

    targets = missing[:max_weeks] if max_weeks > 0 else missing
    logger.info(f"今回処理: {len(targets)} 件")

    script = Path(__file__).parent / "weekly_magazine.py"
    success = 0
    skipped = 0

    for monday in targets:
        logger.info(f"=== マガジン生成: {monday.isoformat()} ===")
        result = subprocess.run(
            [sys.executable, str(script), "--date", monday.isoformat()],
        )
        if result.returncode == 0:
            success += 1
        else:
            logger.warning(
                f"[{monday}] 生成失敗（transcript_failed または配信なし）→ スキップ"
            )
            skipped += 1

    logger.info(f"完了 — 成功: {success} 件 / スキップ: {skipped} 件")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="マガジンバックフィル")
    parser.add_argument(
        "--max-weeks", type=int, default=0,
        help="1回の実行で処理する最大週数（0 = 全件、デフォルト: 0）",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="未生成週の一覧を表示するのみ（実際の生成は行わない）",
    )
    args = parser.parse_args()
    run_backfill(max_weeks=args.max_weeks, dry_run=args.dry_run)
