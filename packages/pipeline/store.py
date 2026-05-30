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
        "ai_model":      "gemini-1.5-flash" if ai_result else None,
        "ai_prompt_ver": "v1" if ai_result else None,
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


def insert_chapters(client: Client, stream_id: str, chapters: list[dict]):
    if not chapters:
        return

    # 既存チャプターを削除してから再挿入
    client.table("chapters").delete().eq("stream_id", stream_id).execute()

    rows = []
    for i, ch in enumerate(chapters):
        rows.append({
            "stream_id":          stream_id,
            "start_sec":          ch.get("start_sec", 0),
            "end_sec":            ch.get("end_sec"),
            "title":              ch.get("title", ""),
            "summary":            ch.get("summary"),
            "transcript_segment": ch.get("transcript_segment"),
            "sort_order":         i,
        })

    client.table("chapters").insert(rows).execute()
    logger.info(f"chapters {len(rows)} 件を挿入: stream_id={stream_id}")


def update_view_count_7d(client: Client, video_meta: dict):
    """7日経過後の再生数を更新"""
    client.table("streams").update(
        {"view_count_7d": video_meta.get("view_count")}
    ).eq("video_id", video_meta["video_id"]).execute()
    logger.info(f"[{video_meta['video_id']}] view_count_7d 更新: {video_meta.get('view_count')}")
