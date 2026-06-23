"""
Supabase にデータを登録・更新するモジュール
"""

import os
import logging
from typing import Optional
from supabase import create_client, Client

logger = logging.getLogger(__name__)

_REVIEW_LOCKED_FIELDS = [
    "summary",
    "tags",
    "corner_names",
    "guests",
    "songs",
    "has_live_singing",
    "talk_topics",
]


def get_supabase_client() -> Client:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定")
    return create_client(url, key)


def get_existing_video_ids(client: Client) -> set[str]:
    resp = client.table("streams").select("video_id").execute()
    return {row["video_id"] for row in (resp.data or [])}


def get_existing_stream(client: Client, video_id: str) -> Optional[dict]:
    resp = client.table("streams").select(
        "id,is_reviewed,summary,tags,corner_names,guests,songs,has_live_singing,talk_topics"
    ).eq("video_id", video_id).limit(1).execute()
    rows = resp.data or []
    return rows[0] if rows else None


def save_transcript_snapshot(client: Client, stream_id: str, source: str, snippets: list[dict]) -> str:
    """transcript_snapshots に保存して snapshot_id を返す。"""
    resp = client.table("transcript_snapshots").insert({
        "stream_id": stream_id,
        "source": source,
        "lang": "ja",
        "snippets": snippets,
    }).execute()
    rows = resp.data or []
    if not rows or not rows[0].get("id"):
        raise ValueError(f"transcript_snapshots insert failed: stream_id={stream_id} source={source}")

    snapshot_id = rows[0]["id"]
    logger.info(f"transcript_snapshot 保存完了: stream_id={stream_id} snapshot_id={snapshot_id} source={source}")
    return snapshot_id


def upsert_stream(client: Client, video_meta: dict, transcript_text: str, transcript_source: str, ai_result: Optional[dict]) -> tuple[str, bool]:
    """
    streams テーブルに1件 upsert する。
    戻り値: (登録された streams.id, レビュー済み動画か)
    """
    existing = get_existing_stream(client, video_meta["video_id"])
    is_review_locked = bool(existing and existing.get("is_reviewed"))

    status = "public"
    if not transcript_text:
        status = "transcript_failed"
    elif ai_result is None:
        status = "summary_failed"

    row = {
        "video_id":      video_meta["video_id"],
        "title":         video_meta["title"],
        "stream_date":   video_meta["stream_date"],
        "started_at":    video_meta.get("started_at"),
        "duration_min":  video_meta.get("duration_min"),
        "view_count":    video_meta.get("view_count"),
        "like_count":    video_meta.get("like_count"),
        "comment_count": video_meta.get("comment_count"),
        "youtube_url":   video_meta.get("youtube_url"),
        "thumbnail_url": video_meta.get("thumbnail_url"),
        "transcript":    transcript_text or None,
        "status":        status,
        "is_reviewed":   is_review_locked,
        "ai_model":      "gemini-2.5-flash" if ai_result else None,
        "ai_prompt_ver": "v3" if ai_result else None,
    }

    if ai_result:
        row["summary"]      = ai_result.get("summary")
        row["tags"]         = ai_result.get("tags", [])
        row["corner_names"] = ai_result.get("corner_names", [])
        row["guests"]       = ai_result.get("guests", [])
        row["songs"]           = ai_result.get("songs", [])
        row["has_live_singing"] = ai_result.get("has_live_singing", False)
        row["talk_topics"]     = ai_result.get("talk_topics", [])
        row["highlights"]      = ai_result.get("highlights", [])

    if is_review_locked and existing:
        for field in _REVIEW_LOCKED_FIELDS:
            row[field] = existing.get(field)
        logger.info(f"[{video_meta['video_id']}] レビュー済みのため手動編集フィールドを保持")

    resp = client.table("streams").upsert(row, on_conflict="video_id").execute()
    stream_id = resp.data[0]["id"]
    logger.info(f"[{video_meta['video_id']}] streams upsert 完了: {stream_id}")

    try:
        from extract_entities import find_entity_ids, load_entities, save_stream_entities, stream_text

        enriched_row = {**row, "id": stream_id}
        entities = load_entities(client)
        entity_ids = find_entity_ids(stream_text(enriched_row), entities)
        count = save_stream_entities(client, stream_id, entity_ids)
        logger.info(f"[{video_meta['video_id']}] stream_entities 保存完了: {count}件")
    except Exception as exc:
        logger.warning(f"[{video_meta['video_id']}] stream_entities 保存をスキップ: {exc}")

    return stream_id, is_review_locked


def _chapter_base_row(stream_id: str, ch: dict, sort_order: int, start_sec: int) -> dict:
    return {
        "stream_id":          stream_id,
        "start_sec":          start_sec,
        "end_sec":            ch.get("end_sec"),
        "title":              ch.get("title", ""),
        "summary":            ch.get("summary"),
        "transcript_segment": ch.get("transcript_segment"),
        "sort_order":         sort_order,
    }


def _coerce_start_sec(value: object) -> int:
    if value is None or value == "":
        return 0
    return int(float(value))


def _build_legacy_chapter_rows(stream_id: str, chapters: list[dict]) -> list[dict]:
    rows = []
    for i, ch in enumerate(chapters):
        row = _chapter_base_row(stream_id, ch, i, _coerce_start_sec(ch.get("start_sec", 0)))
        row["snap_status"] = "legacy"
        rows.append(row)
    return rows


def _rpc_scalar(client: Client, fn: str, params: dict):
    resp = client.rpc(fn, params).execute()
    if resp.data is None:
        raise ValueError(f"rpc returned null: {fn} params={params}")
    return resp.data


def _build_snapped_chapter_rows(client: Client, stream_id: str, chapters: list[dict], snapshot_id: str) -> list[dict]:
    rows = []
    for i, ch in enumerate(chapters):
        ai_start_sec = _coerce_start_sec(ch.get("start_sec", 0))

        snippet_index = int(_rpc_scalar(client, "transcript_snapshot_nearest_snippet_index", {
            "p_snapshot_id": snapshot_id,
            "p_target_sec": float(ai_start_sec),
        }))
        start_sec = int(_rpc_scalar(client, "transcript_snapshot_start_sec", {
            "p_snapshot_id": snapshot_id,
            "p_snippet_index": snippet_index,
        }))
        snap_delta_sec = abs(ai_start_sec - start_sec)
        snap_status = str(_rpc_scalar(client, "derive_snap_status", {
            "p_snap_delta_sec": snap_delta_sec,
        }))

        if snap_status == "drop":
            logger.warning(
                f"chapter dropped: title={ch.get('title')} ai_start_sec={ai_start_sec} delta={snap_delta_sec}"
            )
            continue

        row = _chapter_base_row(stream_id, ch, i, start_sec)
        row.update({
            "snapshot_id":    snapshot_id,
            "snippet_index":  snippet_index,
            "ai_start_sec":   ai_start_sec,
            "snap_delta_sec": snap_delta_sec,
            "snap_status":    snap_status,
        })
        rows.append(row)

    return rows


def insert_chapters(client: Client, stream_id: str, chapters: list[dict], snapshot_id: Optional[str] = None):
    if not chapters:
        return

    # 既存チャプターを削除してから再挿入
    client.table("chapters").delete().eq("stream_id", stream_id).execute()

    if snapshot_id:
        try:
            rows = _build_snapped_chapter_rows(client, stream_id, chapters, snapshot_id)
        except Exception as exc:
            logger.warning(f"chapter snap 失敗。legacy で継続: stream_id={stream_id} snapshot_id={snapshot_id} error={exc}")
            rows = _build_legacy_chapter_rows(stream_id, chapters)
    else:
        rows = _build_legacy_chapter_rows(stream_id, chapters)

    if not rows:
        logger.info(f"chapters 挿入対象なし: stream_id={stream_id}")
        return

    client.table("chapters").insert(rows).execute()
    logger.info(f"chapters {len(rows)} 件を挿入: stream_id={stream_id} snapshot_id={snapshot_id or 'legacy'}")


def update_view_count_7d(client: Client, video_meta: dict):
    """7日経過後の再生数を更新"""
    client.table("streams").update(
        {"view_count_7d": video_meta.get("view_count")}
    ).eq("video_id", video_meta["video_id"]).execute()
    logger.info(f"[{video_meta['video_id']}] view_count_7d 更新: {video_meta.get('view_count')}")


def get_transcript_retry_count(client: Client, video_id: str) -> int:
    """pipeline_jobs に積まれた reprocess_single の件数でリトライ回数を返す"""
    resp = (
        client.table("pipeline_jobs")
        .select("id")
        .eq("video_id", video_id)
        .eq("kind", "reprocess_single")
        .execute()
    )
    return len(resp.data or [])


def queue_pipeline_job(client: Client, kind: str, video_id: str, payload: Optional[dict] = None) -> None:
    from datetime import datetime, timezone
    client.table("pipeline_jobs").insert({
        "kind": kind,
        "video_id": video_id,
        "status": "pending",
        "payload": payload or {},
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    logger.info(f"[{video_id}] pipeline_jobs に追加: kind={kind}")


def update_transcript(client: Client, video_id: str, transcript_text: str, source: str) -> None:
    """Whisper 文字起こし後に transcript と status のみ更新する"""
    client.table("streams").update({
        "transcript": transcript_text,
        "status": "public",
    }).eq("video_id", video_id).execute()
    logger.info(f"[{video_id}] transcript 更新完了: source={source}")
