"""
字幕取得モジュール — 3段階フォールバック
  Step 1: youtube-transcript-api（無料、非公式）
  Step 2: Supadata API（有料フォールバック）
  Step 3: 失敗として記録（Whisperは将来対応）
"""

import os
import logging
import http.cookiejar
import requests
from dataclasses import dataclass
from typing import Optional
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

logger = logging.getLogger(__name__)


@dataclass
class TranscriptResult:
    text: str
    snippets: list[dict]  # [{text, start, duration}, ...]
    source: str           # "youtube_api" | "supadata" | "failed"


def get_transcript(video_id: str) -> TranscriptResult:
    result = _try_youtube_transcript_api(video_id)
    if result:
        return result

    result = _try_supadata(video_id)
    if result:
        return result

    logger.warning(f"[{video_id}] 全フォールバック失敗")
    return TranscriptResult(text="", snippets=[], source="failed")


def _build_api() -> YouTubeTranscriptApi:
    cookies_path = os.getenv("YOUTUBE_COOKIES_PATH")
    if cookies_path:
        session = requests.Session()
        jar = http.cookiejar.MozillaCookieJar(cookies_path)
        jar.load(ignore_discard=True)
        session.cookies = jar
        return YouTubeTranscriptApi(http_client=session)
    return YouTubeTranscriptApi()


def _try_youtube_transcript_api(video_id: str) -> Optional[TranscriptResult]:
    try:
        api = _build_api()
        transcript = api.fetch(video_id, languages=["ja"])
        snippets = [
            {"text": s.text, "start": s.start, "duration": s.duration}
            for s in transcript.snippets
        ]
        full_text = " ".join(s["text"] for s in snippets)
        logger.info(f"[{video_id}] youtube-transcript-api 成功 ({len(snippets)} snippets)")
        return TranscriptResult(text=full_text, snippets=snippets, source="youtube_api")
    except (NoTranscriptFound, TranscriptsDisabled) as e:
        logger.warning(f"[{video_id}] youtube-transcript-api: {e}")
        return None
    except Exception as e:
        logger.warning(f"[{video_id}] youtube-transcript-api 予期しないエラー: {e}")
        return None


def _try_supadata(video_id: str) -> Optional[TranscriptResult]:
    api_key = os.getenv("SUPADATA_API_KEY")
    if not api_key:
        logger.info(f"[{video_id}] SUPADATA_API_KEY 未設定、スキップ")
        return None

    try:
        url = "https://api.supadata.ai/v1/youtube/transcript"
        headers = {"x-api-key": api_key}
        params = {"videoId": video_id, "lang": "ja"}
        resp = requests.get(url, headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()

        content = data.get("content", [])
        snippets = [{"text": s.get("text", ""), "start": s.get("offset", 0) / 1000, "duration": s.get("duration", 0) / 1000} for s in content]
        full_text = " ".join(s["text"] for s in snippets)
        logger.info(f"[{video_id}] Supadata 成功 ({len(snippets)} snippets)")
        return TranscriptResult(text=full_text, snippets=snippets, source="supadata")
    except Exception as e:
        logger.warning(f"[{video_id}] Supadata エラー: {e}")
        return None


def build_timestamped_text(snippets: list[dict]) -> str:
    """プロンプト用のタイムスタンプ付きテキストを生成"""
    lines = []
    for s in snippets:
        start = int(s["start"])
        mm, ss = divmod(start, 60)
        hh, mm = divmod(mm, 60)
        timestamp = f"[{hh:02d}:{mm:02d}:{ss:02d}]"
        lines.append(f"{timestamp} {s['text']}")
    return "\n".join(lines)
