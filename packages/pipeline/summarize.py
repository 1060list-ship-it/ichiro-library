"""
Gemini 1.5 Flash で字幕テキストを要約・構造化するモジュール
"""

import os
import re
import json
import logging
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path
from typing import Optional
from google import genai
from google.genai import types
from google.genai import errors as genai_errors
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

logger = logging.getLogger(__name__)

TARGET_PROMPT_VER = "v4"
PROMPT_VERSION = TARGET_PROMPT_VER
PROMPT_PATH = Path(__file__).parent / "prompts" / f"{TARGET_PROMPT_VER}.txt"
SONG_CATALOG_PATH = Path(__file__).parent / "prompts" / "song_catalog.txt"
SONGS_SQL_PATH = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "013_songs.sql"
MODEL_NAME = "gemini-2.5-flash"


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY が設定されていません")
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=180000))


@lru_cache(maxsize=1)
def _load_song_catalog_text() -> str:
    if SONG_CATALOG_PATH.exists():
        return SONG_CATALOG_PATH.read_text(encoding="utf-8").strip()

    sql = SONGS_SQL_PATH.read_text(encoding="utf-8")
    rows = re.findall(r"^\s*\('([^']*)',\s*'([^']*)'", sql, flags=re.MULTILINE)
    if not rows:
        raise ValueError(f"songs マスタを解析できませんでした: {SONGS_SQL_PATH}")

    albums: OrderedDict[str, list[str]] = OrderedDict()
    for title, album in rows:
        albums.setdefault(album, []).append(title)

    return "\n\n".join(
        f"{album}: {', '.join(titles)}"
        for album, titles in albums.items()
    )


def is_gemini_resource_exhausted(error: genai_errors.APIError) -> bool:
    code = getattr(error, "code", None)
    status = (getattr(error, "status", "") or "").upper()
    return code == 429 or status == "RESOURCE_EXHAUSTED"


def _error_details_text(error: genai_errors.APIError) -> str:
    details = getattr(error, "details", None)
    message = getattr(error, "message", None)
    status = getattr(error, "status", None)
    code = getattr(error, "code", None)
    payload = {"code": code, "status": status, "message": message, "details": details}
    return json.dumps(payload, ensure_ascii=False, default=str).lower()


def gemini_resource_exhaustion_kind(error: genai_errors.APIError) -> str:
    if not is_gemini_resource_exhausted(error):
        return "not_resource_exhausted"

    details_text = _error_details_text(error)
    monthly_spend_terms = (
        "monthly spend cap",
        "monthly usage cap",
        "billing account tier spend cap",
        "start of the next billing cycle",
        "next billing cycle",
        "project-level spend cap",
        "spend caps",
        "spend cap",
        "prepay credit balance",
        "credit balance",
        "no credits",
    )
    per_minute_terms = (
        "per minute",
        "per-minute",
        "per_minute",
        "perminute",
        "rpm",
        "tpm",
        "requestsperminute",
        "tokensperminute",
        "request limit per minute",
        "token limit per minute",
    )
    other_quota_terms = (
        "per day",
        "per-day",
        "per_day",
        "perday",
        "rpd",
        "tpd",
        "requestsperday",
        "tokensperday",
    )

    if any(term in details_text for term in monthly_spend_terms):
        return "monthly_spend_cap"
    if any(term in details_text for term in per_minute_terms):
        return "per_minute_rate_limit"
    if any(term in details_text for term in other_quota_terms):
        return "non_retryable_quota"
    return "unknown_resource_exhausted"


def should_retry_gemini_exception(error: Exception) -> bool:
    if isinstance(error, genai_errors.APIError) and is_gemini_resource_exhausted(error):
        return gemini_resource_exhaustion_kind(error) == "per_minute_rate_limit"
    return True


@retry(
    retry=retry_if_exception(should_retry_gemini_exception),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    stop=stop_after_attempt(4),
    reraise=True,
)
def _generate_with_retry(model, prompt: str):
    return model.models.generate_content(model=MODEL_NAME, contents=prompt)


def summarize(
    transcript_text: str,
    model=None,
    *,
    reraise_resource_exhausted: bool = False,
) -> Optional[dict]:
    """
    字幕テキストを受け取り、構造化データ（dict）を返す。
    失敗時は None を返す。
    """
    if not transcript_text.strip():
        logger.warning("字幕テキストが空です")
        return None

    if model is None:
        model = get_gemini_client()

    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    prompt = (
        prompt_template
        .replace("{song_catalog}", _load_song_catalog_text())
        .replace("{transcript}", transcript_text)
    )

    try:
        response = _generate_with_retry(model, prompt)
        raw = response.text.strip()

        # ```json...``` ブロックがあれば中身だけ取り出す（前置きテキストがあっても対応）
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        if m:
            raw = m.group(1).strip()

        result = json.loads(raw, strict=False)
        _validate_result(result)
        logger.info(f"Gemini 要約完了: chapters={len(result.get('chapters', []))}, highlights={len(result.get('highlights', []))}, tags={result.get('tags', [])}")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"Gemini 応答のJSONパース失敗: {e}\n応答: {raw[:500]}")
        return None
    except genai_errors.APIError as e:
        if reraise_resource_exhausted and is_gemini_resource_exhausted(e):
            raise
        logger.error(f"Gemini API エラー: {e}")
        return None
    except Exception as e:
        logger.error(f"Gemini API エラー: {e}")
        return None


def _validate_result(data: dict):
    required = ["summary", "chapters", "corner_names", "guests", "tags"]
    for key in required:
        if key not in data:
            raise ValueError(f"必須キーが欠落: {key}")

    for ch in data.get("chapters", []):
        for field in ["start_sec", "title", "summary"]:
            if field not in ch:
                raise ValueError(f"chapter に {field} がありません")
