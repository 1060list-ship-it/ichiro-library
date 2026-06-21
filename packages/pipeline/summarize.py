"""
Gemini 1.5 Flash で字幕テキストを要約・構造化するモジュール
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import Optional
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v3"
PROMPT_PATH = Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.txt"
MODEL_NAME = "gemini-2.5-flash"


def get_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY が設定されていません")
    return genai.Client(api_key=api_key)


_NO_THINKING_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(thinking_budget=0)
)


@retry(
    retry=retry_if_exception_type(Exception),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    stop=stop_after_attempt(4),
    reraise=True,
)
def _generate_with_retry(model, prompt: str):
    return model.models.generate_content(model=MODEL_NAME, contents=prompt, config=_NO_THINKING_CONFIG)


def summarize(transcript_text: str, model=None) -> Optional[dict]:
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
    prompt = prompt_template.replace("{transcript}", transcript_text)

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
