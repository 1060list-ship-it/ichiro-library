"""
既存動画をAI再処理する（新プロンプトでsongs・talk_topics・corner_namesを更新）

使い方:
  python reprocess_videos.py                    # TARGET_PROMPT_VER 未達のみ再処理
  python reprocess_videos.py --summary-missing-only  # summary IS NULL のみ（旧 --no-summary-only）
  python reprocess_videos.py --recent-first     # 最新配信から再処理
  python reprocess_videos.py --refetch          # snapshot があっても字幕を再取得
  python reprocess_videos.py --dry-run          # 確認のみ
  python reprocess_videos.py --video VIDEO_ID   # 特定動画のみ
  429で中断した場合はフラグなしで再実行すれば TARGET_PROMPT_VER 未達分だけ再開される
"""

import hashlib
import json
import os
import shlex
import signal
import subprocess
import sys
import time
import logging
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from google.genai import errors as genai_errors

load_dotenv(Path(__file__).parent.parent.parent / ".env.local")

from get_transcript import TranscriptResult, get_transcript, build_timestamped_text
from summarize import (
    MODEL_NAME,
    TARGET_PROMPT_VER,
    gemini_resource_exhaustion_kind,
    get_gemini_client,
    is_gemini_resource_exhausted,
    summarize,
)
from store import _REVIEW_LOCKED_FIELDS, get_supabase_client, insert_chapters, save_transcript_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("reprocess")

SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[2]
AI_WORK_ROOT = Path(os.environ.get("AI_WORK_REPO", str(PROJECT_ROOT.parents[1]))).expanduser()
PROD_GUARD_DIR = Path(
    os.environ.get(
        "AI_WORK_PROD_GUARD_DIR",
        str(AI_WORK_ROOT / "10_system" / "codex_runtime" / "prod_guard"),
    )
).expanduser()
LOCK_JOB = "reprocess_videos"
LOCK_PROJECT = "ichiro-library"
LOCK_PATH = PROD_GUARD_DIR / f"running_{LOCK_PROJECT}_{LOCK_JOB}.lock"
STALE_LOCK_DIR = PROD_GUARD_DIR / "stale"
PERMANENT_FAILURE_STATUSES = ("transcript_failed", "summary_failed")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalise_command(command: str) -> str:
    return command.replace("\r\n", "\n").replace("\r", "\n").strip()


def _command_line() -> str:
    return shlex.join([sys.executable, *sys.argv])


def _command_hash(command: str) -> str:
    return hashlib.sha256(_normalise_command(command).encode("utf-8")).hexdigest()


def _process_start(pid: int) -> str:
    try:
        result = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            text=True,
            capture_output=True,
            timeout=2,
            check=False,
        )
    except Exception:
        return ""

    line = result.stdout.strip()
    return " ".join(line.split())


def _process_matches_lock(payload: Optional[dict]) -> bool:
    if not payload:
        return False
    try:
        pid = int(payload.get("pid") or 0)
    except (TypeError, ValueError):
        return False
    if not _pid_exists(pid):
        return False

    expected_start = " ".join(str(payload.get("process_start") or "").split())
    if not expected_start:
        return True

    actual_start = _process_start(pid)
    if not actual_start:
        return True
    return actual_start == expected_start


def _pid_exists(pid: Optional[int]) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _read_lock(path: Path) -> Optional[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _exclusive_create_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")
    except Exception:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise


def _move_stale_lock(path: Path, payload: Optional[dict], reason: str) -> None:
    STALE_LOCK_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = _utc_now().strftime("%Y%m%dT%H%M%SZ")
    stale_pid = "unknown"
    if payload:
        stale_pid = str(payload.get("pid") or "unknown")
    destination = STALE_LOCK_DIR / f"{path.stem}.{timestamp}.pid{stale_pid}.lock"
    if payload is None:
        payload = {}
    payload.update(
        stale_detected_at=_iso(_utc_now()),
        stale_reason=reason,
        original_lock_path=str(path),
    )
    _atomic_write_json(destination, payload)
    try:
        path.unlink()
    except FileNotFoundError:
        pass


class ProductionRunLock:
    def __init__(self, enabled: bool):
        self.enabled = enabled
        self.path = LOCK_PATH
        self.payload: Optional[dict] = None
        self.previous_handlers: dict[int, signal.Handlers] = {}

    def __enter__(self):
        if not self.enabled:
            return self
        self._prepare_existing_lock()
        self._create_lock()
        self._install_signal_handlers()
        logger.info(f"prod_guard lock作成: {self.path}")
        return self

    def __exit__(self, exc_type, exc, tb):
        self.cleanup()
        self._restore_signal_handlers()
        return False

    def _prepare_existing_lock(self) -> None:
        if not self.path.exists():
            return

        payload = _read_lock(self.path)
        pid = None
        if payload:
            try:
                pid = int(payload.get("pid") or 0)
            except (TypeError, ValueError):
                pid = None

        if _process_matches_lock(payload):
            raise SystemExit(
                f"active prod_guard lockが存在するため中止: {self.path} "
                f"(pid={pid}, job={payload.get('job') if payload else 'unknown'})"
            )

        reason = "pid_not_alive_on_start"
        if pid and _pid_exists(pid):
            reason = "pid_reused_or_process_start_mismatch"
        _move_stale_lock(self.path, payload, reason)
        logger.warning(f"stale prod_guard lockを退避: {self.path}")

    def _create_lock(self) -> None:
        now = _utc_now()
        command = _command_line()
        pid = os.getpid()
        try:
            pgid = os.getpgid(0)
        except OSError:
            pgid = pid

        self.payload = {
            "job": LOCK_JOB,
            "project": LOCK_PROJECT,
            "pid": pid,
            "pgid": pgid,
            "process_start": _process_start(pid),
            "cwd": str(Path.cwd()),
            "command_hash": _command_hash(command),
            "command": command,
            "started_at": _iso(now),
            "heartbeat_at": _iso(now),
        }
        try:
            _exclusive_create_json(self.path, self.payload)
        except FileExistsError:
            existing = _read_lock(self.path)
            existing_pid = existing.get("pid") if existing else "unknown"
            existing_job = existing.get("job") if existing else "unknown"
            raise SystemExit(
                f"prod_guard lock作成が競合したため中止: {self.path} "
                f"(pid={existing_pid}, job={existing_job})"
            )

    def heartbeat(self) -> None:
        if not self.enabled or self.payload is None:
            return
        self.payload["heartbeat_at"] = _iso(_utc_now())
        _atomic_write_json(self.path, self.payload)

    def cleanup(self) -> None:
        if not self.enabled or self.payload is None:
            return
        current = _read_lock(self.path)
        if not current:
            self.payload = None
            return
        same_process = current.get("pid") == self.payload.get("pid")
        same_command = current.get("command_hash") == self.payload.get("command_hash")
        if same_process and same_command:
            try:
                self.path.unlink()
                logger.info(f"prod_guard lock削除: {self.path}")
            except FileNotFoundError:
                pass
        self.payload = None

    def _install_signal_handlers(self) -> None:
        for sig in (signal.SIGINT, signal.SIGTERM):
            self.previous_handlers[sig] = signal.getsignal(sig)
            signal.signal(sig, self._handle_signal)

    def _restore_signal_handlers(self) -> None:
        for sig, handler in self.previous_handlers.items():
            signal.signal(sig, handler)
        self.previous_handlers.clear()

    def _handle_signal(self, signum, frame) -> None:
        logger.warning(f"signal {signum} を受信。prod_guard lockをcleanupして終了")
        self.cleanup()
        raise SystemExit(128 + signum)


def _count_processed_streams(supabase) -> int:
    response = (
        supabase.table("streams")
        .select("id", count="exact")
        .or_(f"ai_prompt_ver.eq.{TARGET_PROMPT_VER},is_reviewed.is.true")
        .execute()
    )
    return response.count or 0


def _exclude_permanent_failures(query):
    for status in PERMANENT_FAILURE_STATUSES:
        query = query.neq("status", status)
    return query


def _exclude_reviewed(query):
    return query.not_.is_("is_reviewed", "true")


def _mark_stream_status(supabase, video_id: str, status: str) -> None:
    supabase.table("streams").update({"status": status}).eq("video_id", video_id).execute()
    logger.info(f"[{video_id}] status={status} に更新")


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
        return False

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

    summary_input = None
    summary_input_source = None

    if transcript_result.source == "failed" or not transcript_result.snippets:
        if not transcript_text:
            logger.warning(f"[{video_id}] 字幕なし、スキップ")
            if not dry_run:
                _mark_stream_status(supabase, video_id, "transcript_failed")
            return False
        summary_input = transcript_text
        summary_input_source = "streams.transcript"
    else:
        timestamped_text = build_timestamped_text(transcript_result.snippets)
        if not timestamped_text:
            if not transcript_text:
                logger.warning(f"[{video_id}] 字幕テキスト空、スキップ")
                if not dry_run:
                    _mark_stream_status(supabase, video_id, "transcript_failed")
                return False
            summary_input = transcript_text
            summary_input_source = "streams.transcript"
        else:
            summary_input = timestamped_text
            summary_input_source = "timestamped transcript"

    if dry_run:
        logger.info(
            f"[{video_id}] dry-run: Gemini呼び出しなし "
            f"(input={summary_input_source}, chars={len(summary_input or '')})"
        )
        return True

    ai_result = summarize(
        summary_input or "",
        model=gemini,
        reraise_resource_exhausted=True,
    )

    if not ai_result:
        logger.warning(f"[{video_id}] AI再処理失敗")
        _mark_stream_status(supabase, video_id, "summary_failed")
        return False

    logger.info(f"[{video_id}] corner_names={ai_result.get('corner_names')} songs={ai_result.get('songs')} topics={ai_result.get('talk_topics')}")

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

    chapters = ai_result.get("chapters") or []
    if not chapters:
        logger.warning(f"[{video_id}] chapters が空のため刻印せずスキップ")
        return False

    inserted_chapters = insert_chapters(supabase, stream_id, chapters, snapshot_id=snapshot_id)
    if inserted_chapters <= 0:
        logger.warning(f"[{video_id}] chapters 挿入0件のため刻印せずスキップ")
        return False

    stream_update = {
        "summary":        ai_result.get("summary"),
        "tags":           ai_result.get("tags", []),
        "corner_names":   ai_result.get("corner_names", []),
        "guests":         ai_result.get("guests", []),
        "songs":          ai_result.get("songs", []),
        "talk_topics":    ai_result.get("talk_topics", []),
        "has_live_singing": ai_result.get("has_live_singing", False),
        "highlights":     ai_result.get("highlights", []),
        "ai_model":       MODEL_NAME,
        "ai_prompt_ver":  TARGET_PROMPT_VER,
    }
    if row.get("status") in PERMANENT_FAILURE_STATUSES:
        stream_update["status"] = "public"

    if force and row.get("is_reviewed"):
        for field in _REVIEW_LOCKED_FIELDS:
            stream_update.pop(field, None)
        logger.info(f"[{video_id}] レビュー済みのため手動編集フィールドを保持")

    supabase.table("streams").update(stream_update).eq("video_id", video_id).execute()

    logger.info(f"[{video_id}] 更新完了: chapters={inserted_chapters} prompt={TARGET_PROMPT_VER}")
    return True


def run(
    dry_run: bool = False,
    target_video_id: str = None,
    summary_missing_only: bool = False,
    recent_first: bool = False,
    refetch: bool = False,
    whisper_only: bool = False,
    skip_dates = None,
    prod_lock: ProductionRunLock = None,
):
    supabase = get_supabase_client()
    gemini = get_gemini_client()
    processed_before = _count_processed_streams(supabase)
    successful_count = 0

    skip_dates = set(skip_dates or [])
    logger.info(f"開始前の処理済み件数({TARGET_PROMPT_VER} or reviewed): {processed_before}件")
    if prod_lock:
        prod_lock.heartbeat()

    whisper_stream_ids = None
    if whisper_only and not target_video_id:
        whisper_rows = (
            supabase.table("transcript_snapshots")
            .select("stream_id")
            .eq("source", "whisper")
            .execute()
            .data
            or []
        )
        whisper_stream_ids = sorted({
            row.get("stream_id")
            for row in whisper_rows
            if row.get("stream_id")
        })
        if not whisper_stream_ids:
            logger.info("source='whisper' の transcript_snapshot がないため終了")
            return
        logger.info(f"モード: whisper 由来 snapshot の stream のみ ({len(whisper_stream_ids)}件)")
    elif whisper_only and target_video_id:
        logger.info("--video 指定のため --whisper-only は無視する")

    query = supabase.table("streams").select("id,video_id,transcript,is_reviewed,status,stream_date,ai_prompt_ver")
    if target_video_id:
        query = query.eq("video_id", target_video_id)
        logger.info("--video 指定のため TARGET_PROMPT_VER/status/reviewed フィルタは適用しない")
    elif summary_missing_only:
        query = query.is_("summary", "null")
        query = _exclude_permanent_failures(_exclude_reviewed(query))
        logger.info("モード: summary IS NULL のみ（TARGET_PROMPT_VER基準より優先）")
    else:
        query = query.or_(f"ai_prompt_ver.is.null,ai_prompt_ver.neq.{TARGET_PROMPT_VER}")
        query = _exclude_permanent_failures(_exclude_reviewed(query))
        logger.info(f"モード: ai_prompt_ver != {TARGET_PROMPT_VER} または NULL のみ")
    if whisper_stream_ids is not None:
        query = query.in_("id", whisper_stream_ids)

    rows = query.order("stream_date", desc=recent_first).execute().data or []

    total = len(rows)
    logger.info(f"再処理対象: {total}件")

    SKIP_IDS: list[str] = []  # 問題のある動画IDをここに追加

    try:
        for i, row in enumerate(rows):
            if prod_lock:
                prod_lock.heartbeat()
            vid = row['video_id']
            stream_date = row.get("stream_date")
            if stream_date in skip_dates:
                logger.info(f"--- {i + 1}/{total}件目: {vid} {stream_date} スキップ ---")
                continue
            if vid in SKIP_IDS:
                logger.info(f"--- {i + 1}/{total}件目: {vid} スキップ ---")
                continue
            logger.info(f"--- {i + 1}/{total}件目: {vid} ---")
            try:
                if reprocess_one(
                    supabase,
                    gemini,
                    row,
                    dry_run,
                    force=bool(target_video_id),
                    refetch=refetch,
                ):
                    successful_count += 1
            except genai_errors.APIError as e:
                if is_gemini_resource_exhausted(e):
                    kind = gemini_resource_exhaustion_kind(e)
                    logger.error(
                        f"Gemini RESOURCE_EXHAUSTED({kind}) 到達、処理を中断します"
                        f"（成功済み: {successful_count}/{total}件）"
                    )
                    raise SystemExit(1)
                logger.error(f"[{vid}] エラー: {e}", exc_info=True)
            except Exception as e:
                logger.error(f"[{vid}] エラー: {e}", exc_info=True)
            if i < total - 1:
                time.sleep(5)
                if prod_lock:
                    prod_lock.heartbeat()

        logger.info("全件完了")
    finally:
        processed_after = _count_processed_streams(supabase)
        logger.info(f"終了後の処理済み件数({TARGET_PROMPT_VER} or reviewed): {processed_after}件")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--video", type=str, help="特定の動画IDのみ再処理")
    parser.add_argument(
        "--summary-missing-only",
        "--no-summary-only",
        dest="summary_missing_only",
        action="store_true",
        help="summary IS NULL の動画のみ再処理（旧 --no-summary-only。429再開には使わない）",
    )
    parser.add_argument("--recent-first", action="store_true", help="最新配信から再処理（7月リプロセス用）")
    parser.add_argument("--refetch", action="store_true", help="snapshot があっても字幕を再取得する")
    parser.add_argument("--whisper-only", action="store_true", help="transcript_snapshots.source='whisper' の stream のみ再処理する")
    parser.add_argument("--skip-date", action="append", default=[], help="指定した stream_date (YYYY-MM-DD) をスキップする。複数回指定可")
    args = parser.parse_args()
    lock_required = not args.video
    with ProductionRunLock(enabled=lock_required) as prod_lock:
        run(
            dry_run=args.dry_run,
            target_video_id=args.video,
            summary_missing_only=args.summary_missing_only,
            recent_first=args.recent_first,
            refetch=args.refetch,
            whisper_only=args.whisper_only,
            skip_dates=args.skip_date,
            prod_lock=prod_lock if lock_required else None,
        )
