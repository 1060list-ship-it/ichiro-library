"""
既存の streams / magazines から entities を抽出し、中間テーブルへ保存する。

使い方:
  cd /Users/ikkiair/Projects/AI_work/03_personal_projects/ichiro-library
  packages/pipeline/.venv/bin/python packages/pipeline/extract_entities.py
"""

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env.local")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("extract_entities")


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL または NEXT_PUBLIC_SUPABASE_URL が未設定")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY が未設定")
    return create_client(url, key)


def load_entities(client: Client) -> list[dict]:
    response = client.table("entities").select("id, slug, name, match_names").execute()
    entities = response.data or []
    logger.info(f"entities 読み込み: {len(entities)}件")
    return entities


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "\n".join(_stringify(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(_stringify(item) for item in value.values())
    return json.dumps(value, ensure_ascii=False)


def stream_text(stream: dict) -> str:
    return "\n".join(
        _stringify(stream.get(key))
        for key in ("title", "summary", "talk_topics", "guests", "songs", "highlights")
    )


def magazine_text(magazine: dict) -> str:
    return _stringify(magazine.get("content"))


def find_entity_ids(text: str, entities: list[dict]) -> list[str]:
    matched_ids: list[str] = []
    seen_ids: set[str] = set()

    aliases: list[tuple[str, str]] = []
    for entity in entities:
        for name in entity.get("match_names") or []:
            if len(name) >= 3:
                aliases.append((name, entity["id"]))

    aliases.sort(key=lambda item: len(item[0]), reverse=True)

    for name, entity_id in aliases:
        if entity_id in seen_ids:
            continue
        if name in text:
            seen_ids.add(entity_id)
            matched_ids.append(entity_id)

    return matched_ids


def save_stream_entities(client: Client, stream_id: str, entity_ids: list[str], dry_run: bool = False) -> int:
    if dry_run:
        return len(entity_ids)

    client.table("stream_entities").delete().eq("stream_id", stream_id).execute()
    if not entity_ids:
        return 0

    rows = [{"stream_id": stream_id, "entity_id": entity_id} for entity_id in entity_ids]
    client.table("stream_entities").upsert(rows, on_conflict="stream_id,entity_id").execute()
    return len(rows)


def save_magazine_entities(client: Client, magazine_id: str, entity_ids: list[str], dry_run: bool = False) -> int:
    if dry_run:
        return len(entity_ids)

    client.table("magazine_entities").delete().eq("magazine_id", magazine_id).execute()
    if not entity_ids:
        return 0

    rows = [{"magazine_id": magazine_id, "entity_id": entity_id} for entity_id in entity_ids]
    client.table("magazine_entities").upsert(rows, on_conflict="magazine_id,entity_id").execute()
    return len(rows)


def backfill_streams(client: Client, entities: list[dict], dry_run: bool = False) -> int:
    response = client.table("streams").select(
        "id, title, summary, talk_topics, guests, songs, highlights"
    ).execute()
    streams = response.data or []
    total_links = 0

    for stream in streams:
        entity_ids = find_entity_ids(stream_text(stream), entities)
        count = save_stream_entities(client, stream["id"], entity_ids, dry_run=dry_run)
        total_links += count
        logger.info(f"stream {stream['id']}: {count}件")

    return total_links


def backfill_magazines(client: Client, entities: list[dict], dry_run: bool = False) -> int:
    response = client.table("magazines").select("id, week_label, content").execute()
    magazines = response.data or []
    total_links = 0

    for magazine in magazines:
        entity_ids = find_entity_ids(magazine_text(magazine), entities)
        count = save_magazine_entities(client, magazine["id"], entity_ids, dry_run=dry_run)
        total_links += count
        logger.info(f"magazine {magazine.get('week_label', magazine['id'])}: {count}件")

    return total_links


def backfill(dry_run: bool = False) -> None:
    client = get_client()
    entities = load_entities(client)
    stream_links = backfill_streams(client, entities, dry_run=dry_run)
    magazine_links = backfill_magazines(client, entities, dry_run=dry_run)
    logger.info(f"完了: stream_entities={stream_links}件, magazine_entities={magazine_links}件")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="streams / magazines から entity リンクを抽出する")
    parser.add_argument("--dry-run", action="store_true", help="DBを書き換えず件数だけ確認する")
    args = parser.parse_args()
    backfill(dry_run=args.dry_run)
