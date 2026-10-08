"""live_chat リプレイJSONから superchats テーブルへ取り込む。

使い方:
    python import_superchats.py --video-id <VIDEO_ID> --chat-json <PATH>

yt-dlp で事前に取得:
    yt-dlp --write-subs --sub-langs "live_chat" --skip-download \\
        -o "%(id)s.%(ext)s" "https://www.youtube.com/watch?v=<VIDEO_ID>"
"""

import argparse
import json
import logging
import re
import sys

sys.path.insert(0, ".")

from store import get_supabase_client  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CURRENCY_SYMS = {"¥": "JPY", "$": "USD", "€": "EUR", "£": "GBP", "₩": "KRW"}


def parse_amount(text: str):
    m = re.match(r"^\s*([¥$€£₩])\s*([\d,]+(?:\.\d+)?)", text or "")
    if not m:
        return None, None
    try:
        return CURRENCY_SYMS.get(m.group(1), m.group(1)), float(m.group(2).replace(",", ""))
    except ValueError:
        return None, None


def extract_rows(chat_json_path: str) -> list[dict]:
    rows = []
    with open(chat_json_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            offset = obj.get("videoOffsetTimeMsec")
            try:
                chat_time_ms = int(offset) if offset is not None else None
            except (TypeError, ValueError):
                chat_time_ms = None
            for action in obj.get("replayChatItemAction", {}).get("actions", []):
                item = (action.get("addChatItemAction") or {}).get("item", {})
                target = item.get("liveChatPaidMessageRenderer")
                kind = "paid_message"
                if target is None:
                    target = item.get("liveChatPaidStickerRenderer")
                    kind = "paid_sticker"
                if target is None:
                    continue
                item_id = target.get("id")
                if not item_id:
                    continue
                amount_text = ((target.get("purchaseAmountText") or {}).get("simpleText")) or ""
                currency, value = parse_amount(amount_text)
                if currency is None or value is None:
                    logger.warning(f"金額を解析できません: {amount_text!r} (item {item_id})")
                    continue
                author = (target.get("authorName") or {}).get("simpleText") or "?"
                channel_id = target.get("authorExternalChannelId") or author
                message = "".join(
                    run.get("text", "") for run in ((target.get("message") or {}).get("runs") or [])
                ) or None
                rows.append({
                    "item_id": item_id,
                    "author_channel_id": channel_id,
                    "author_name": author,
                    "amount_text": amount_text.strip(),
                    "amount_value": value,
                    "currency": currency,
                    "message": message,
                    "chat_time_ms": chat_time_ms,
                    "kind": kind,
                })
    # 同一 item_id の重複を除去（ticker との二重収録に備える）
    seen: dict[str, dict] = {}
    for row in rows:
        seen.setdefault(row["item_id"], row)
    return list(seen.values())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--chat-json", required=True)
    args = parser.parse_args()

    rows = extract_rows(args.chat_json)
    logger.info(f"抽出: {len(rows)} 件 ({args.chat_json})")
    if not rows:
        logger.info("取り込む行がありません")
        return 0

    client = get_supabase_client()
    stream = (
        client.table("streams").select("id").eq("video_id", args.video_id).limit(1).execute()
    )
    if not stream.data:
        logger.error(f"streams に存在しません: {args.video_id}")
        return 1
    stream_id = stream.data[0]["id"]

    payload = [{**row, "stream_id": stream_id, "video_id": args.video_id} for row in rows]
    resp = client.table("superchats").upsert(payload, on_conflict="video_id,item_id").execute()
    logger.info(f"保存完了: {len(resp.data or [])} 件 (video_id={args.video_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
