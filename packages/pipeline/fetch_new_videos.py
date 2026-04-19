"""
YouTube Data API v3 で新着ライブ配信動画を取得するモジュール
"""

import os
import logging
import isodate
from datetime import datetime, timezone
from typing import Optional
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

CHANNEL_HANDLE = "ichiroyamaguchichannel"


def get_youtube_client():
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY が設定されていません")
    return build("youtube", "v3", developerKey=api_key)


def get_channel_id(youtube) -> str:
    resp = youtube.channels().list(
        part="id",
        forHandle=CHANNEL_HANDLE,
    ).execute()
    items = resp.get("items", [])
    if not items:
        raise ValueError(f"チャンネルが見つかりません: {CHANNEL_HANDLE}")
    return items[0]["id"]


def fetch_live_archives(youtube, channel_id: str, published_after: Optional[datetime] = None) -> list[dict]:
    """チャンネルのライブ配信アーカイブ動画一覧を取得"""
    videos = []
    page_token = None

    params = {
        "part": "id",
        "channelId": channel_id,
        "type": "video",
        "eventType": "completed",   # 完了したライブ配信のみ
        "order": "date",
        "maxResults": 50,
    }
    if published_after:
        params["publishedAfter"] = published_after.strftime("%Y-%m-%dT%H:%M:%SZ")

    while True:
        if page_token:
            params["pageToken"] = page_token

        resp = youtube.search().list(**params).execute()
        video_ids = [item["id"]["videoId"] for item in resp.get("items", [])]

        if video_ids:
            details = _fetch_video_details(youtube, video_ids)
            videos.extend(details)

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    logger.info(f"{len(videos)} 件の動画を取得")
    return videos


def _fetch_video_details(youtube, video_ids: list[str]) -> list[dict]:
    resp = youtube.videos().list(
        part="id,snippet,statistics,contentDetails,liveStreamingDetails",
        id=",".join(video_ids),
    ).execute()

    results = []
    for item in resp.get("items", []):
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        content = item.get("contentDetails", {})
        live = item.get("liveStreamingDetails", {})

        duration_min = None
        raw_duration = content.get("duration")
        if raw_duration:
            try:
                duration_min = int(isodate.parse_duration(raw_duration).total_seconds() // 60)
            except Exception:
                pass

        actual_start = live.get("actualStartTime") or snippet.get("publishedAt")
        stream_date = None
        if actual_start:
            try:
                stream_date = datetime.fromisoformat(actual_start.replace("Z", "+00:00")).date().isoformat()
            except Exception:
                pass

        results.append({
            "video_id": item["id"],
            "title": snippet.get("title", ""),
            "stream_date": stream_date,
            "duration_min": duration_min,
            "view_count": int(stats.get("viewCount", 0)) or None,
            "comment_count": int(stats.get("commentCount", 0)) or None,
            "youtube_url": f"https://www.youtube.com/watch?v={item['id']}",
            "thumbnail_url": snippet.get("thumbnails", {}).get("maxres", {}).get("url")
                             or snippet.get("thumbnails", {}).get("high", {}).get("url"),
        })

    return results


def filter_new_videos(videos: list[dict], existing_ids: set[str]) -> list[dict]:
    return [v for v in videos if v["video_id"] not in existing_ids]
