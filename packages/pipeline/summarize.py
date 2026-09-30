"""
Gemini 1.5 Flash で字幕テキストを要約・構造化するモジュール
"""

import os
import re
import json
import logging
from collections import OrderedDict
from datetime import date as _date, datetime as _dt
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
ENTITY_CATALOG_PATH = Path(__file__).parent / "prompts" / "entity_catalog.txt"
SONGS_SQL_PATH = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "013_songs.sql"
MODEL_NAME = "gemini-2.5-flash"

WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"]

# summary冒頭文で「当日の日付を指す」とみなす表現。未来のイベント告知との誤検知を避けるため、
# 「配信」等の配信自称動詞と結合した形のみを対象にする。
# 日跨ぎ配信（stream_date が前日付け・タイトルが当日付け）が日常的なため、前後1日のずれは許容する。
_MD_SELF_PAT = re.compile(r"(\d{1,2})月(\d{1,2})日(?:の[^。、]{0,15}?(?:配信|スタート|始ま)|(?:深夜)?に(?:行われた|配信された|始まった|スタート))")
_FULL_DATE_PAT = re.compile(r"20(\d{2})年(\d{1,2})月(\d{1,2})日")
_SELF_VERB_PAT = re.compile(r"配信|スタート|始ま|行わ|幕を開|ライブは|ライブが")


def _coerce_stream_date(stream_date) -> Optional[_date]:
    if stream_date is None:
        return None
    if isinstance(stream_date, _dt):
        return stream_date.date()
    if isinstance(stream_date, _date):
        return stream_date
    try:
        return _date.fromisoformat(str(stream_date)[:10])
    except ValueError:
        return None


def validate_summary_dates(summary: str, stream_date) -> list[str]:
    """要約冒頭文の日付が配信日と矛盾していないか検査する。問題がなければ []。

    2026-09-29 の全319件横断チェックで見つかった誤りパターン（年号ずれ・月日ずれ）が対象。
    未来イベントの告知（「3月16日に解禁」「2026年元旦」「2025年度」等）は誤検知しない。
    日跨ぎ配信が日常的なため、前後1日のずれは許容する。
    """
    from datetime import timedelta as _td
    issues: list[str] = []
    day = _coerce_stream_date(stream_date)
    if day is None or not summary:
        return issues
    first = re.split(r"。", summary)[0]
    allowed = {day + _td(days=d) for d in (-1, 0, 1)}

    def _candidate(y: int, mo: int, da: int):
        try:
            return _date(y, mo, da)
        except ValueError:
            return None

    if _SELF_VERB_PAT.search(first):
        for m in _FULL_DATE_PAT.finditer(first):
            cand = _candidate(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3)))
            if cand is not None and cand not in allowed:
                issues.append(f"冒頭文の日付 {m.group(0)} が配信日 {day.isoformat()} と不一致")

    for m in _MD_SELF_PAT.finditer(first):
        cand = _candidate(day.year, int(m.group(1)), int(m.group(2)))
        if cand is not None and cand not in allowed:
            issues.append(f"冒頭文の日付 {m.group(0)[:20]}… が配信日 {day.isoformat()} と不一致")

    return issues


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY が設定されていません")
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=180000))


@lru_cache(maxsize=1)
def _load_entity_catalog_text() -> str:
    if ENTITY_CATALOG_PATH.exists():
        return ENTITY_CATALOG_PATH.read_text(encoding="utf-8").strip()
    return ""


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
    stream_date=None,
    reraise_resource_exhausted: bool = False,
) -> Optional[dict]:
    """
    字幕テキストを受け取り、構造化データ（dict）を返す。
    stream_date（YYYY-MM-DD 文字列 / date / datetime）を渡すと、
    プロンプトに配信日を注入し、生成後の冒頭文の日付矛盾を警告ログで検知する。
    失敗時は None を返す。
    """
    if not transcript_text.strip():
        logger.warning("字幕テキストが空です")
        return None

    if model is None:
        model = get_gemini_client()

    day = _coerce_stream_date(stream_date)
    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    prompt = (
        prompt_template
        .replace("{song_catalog}", _load_song_catalog_text())
        .replace("{entity_catalog}", _load_entity_catalog_text())
        .replace("{transcript}", transcript_text)
    )
    if day is not None:
        wd = WEEKDAYS_JA[day.weekday()]
        date_block = (
            f"## 配信日（厳守）\n"
            f"この配信の日付は{day.year}年{day.month}月{day.day}日（{wd}曜日）です。\n"
            f"summaryの冒頭で配信当日の日付に触れる場合は、必ずこの日付と一致させ、"
            f"他の年・月・日を書かないでください。"
            f"未来のイベント告知で別の日付に触れる場合は、配信当日と区別できる書き方にしてください。\n\n"
        )
        prompt = date_block + prompt

    try:
        response = _generate_with_retry(model, prompt)
        raw = response.text.strip()

        # ```json...``` ブロックがあれば中身だけ取り出す（前置きテキストがあっても対応）
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        if m:
            raw = m.group(1).strip()

        result = json.loads(raw, strict=False)
        _validate_result(result)
        if day is not None:
            for issue in validate_summary_dates(result.get("summary", ""), day):
                logger.warning(f"要約の日付検証: {issue}")
        logger.info(f"Gemini 要約完了: chapters={len(result.get('chapters', []))}, tags={result.get('tags', [])}")
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
