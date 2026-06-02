"""
サカナクション・山口一郎に関する外部メディア情報を取得する。
Google News RSS と setlist.fm RSS を使用（APIキー不要）。
"""

import argparse
import json
import logging
import re
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Optional

import requests

try:
    import feedparser
except ImportError:  # pragma: no cover - requirements.txt で導入する前の安全策
    feedparser = None


logger = logging.getLogger("fetch_media_news")

REQUEST_HEADERS = {"User-Agent": "ichiro-library/1.0"}
RSS_SOURCES = [
    (
        "Google News",
        "https://news.google.com/rss/search?q=%E3%82%B5%E3%82%AB%E3%83%8A%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%B3&hl=ja&gl=JP&ceid=JP:ja",
    ),
    (
        "Google News",
        "https://news.google.com/rss/search?q=%E5%B1%B1%E5%8F%A3%E4%B8%80%E9%83%8E+%E3%82%B5%E3%82%AB%E3%83%8A%E3%82%AF%E3%82%B7%E3%83%A7%E3%83%B3&hl=ja&gl=JP&ceid=JP:ja",
    ),
    (
        "setlist.fm",
        "https://www.setlist.fm/search?query=Sakanaction&rss",
    ),
]


def _clean_text(value: Optional[str]) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", "", value)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _entry_source(entry, default_source: str) -> str:
    source = entry.get("source")
    if isinstance(source, dict):
        title = source.get("title")
        if title:
            return str(title)
    return default_source


def _entry_date(entry) -> Optional[date]:
    pub_date = entry.get("pubDate") or entry.get("published") or entry.get("updated")
    if not pub_date:
        return None
    try:
        return parsedate_to_datetime(pub_date).date()
    except (TypeError, ValueError, IndexError, OverflowError) as exc:
        logger.warning("pubDate のパースに失敗: %s", exc)
        return None


def _fetch_feed(source_name: str, url: str, week_start: date, week_end: date) -> list[dict]:
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("%s RSS取得失敗（スキップ）: %s", source_name, exc)
        return []

    feed = feedparser.parse(response.content)
    if getattr(feed, "bozo", False):
        logger.warning(
            "%s RSSパース警告（取得できた項目のみ使用）: %s",
            source_name,
            getattr(feed, "bozo_exception", "unknown"),
        )

    items = []
    for entry in feed.entries:
        published = _entry_date(entry)
        if not published or published < week_start or published > week_end:
            continue

        url = entry.get("link") or entry.get("id")
        if not url:
            continue

        items.append({
            "title": _clean_text(entry.get("title")),
            "source": _entry_source(entry, source_name),
            "url": str(url),
            "published": published.isoformat(),
            "snippet": _clean_text(entry.get("summary") or entry.get("description")),
        })

    return items


def fetch_media_news(week_start: date, week_end: date) -> list[dict]:
    if feedparser is None:
        raise RuntimeError("feedparser が未インストールです。packages/pipeline/requirements.txt を適用してください")
    if week_end < week_start:
        raise ValueError("week_end must be greater than or equal to week_start")

    mentions = []
    seen_urls = set()

    for source_name, rss_url in RSS_SOURCES:
        try:
            source_items = _fetch_feed(source_name, rss_url, week_start, week_end)
        except Exception as exc:
            logger.warning("%s RSS処理失敗（スキップ）: %s", source_name, exc)
            continue

        for item in source_items:
            if item["url"] in seen_urls:
                continue
            seen_urls.add(item["url"])
            mentions.append(item)

    return sorted(mentions, key=lambda item: item["published"], reverse=True)


def _week_range_for(target: date):
    monday = target - timedelta(days=target.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="外部メディアRSSから今週の言及を取得する")
    parser.add_argument("--date", help="対象週に含まれる日付 YYYY-MM-DD（デフォルト: 昨日）")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    target_date = date.fromisoformat(args.date) if args.date else date.today() - timedelta(days=1)
    start, end = _week_range_for(target_date)

    try:
        result = fetch_media_news(start, end)
    except Exception as exc:
        logger.error("外部メディア情報取得失敗: %s", exc)
        raise SystemExit(1)

    print(json.dumps(result, ensure_ascii=False, indent=2))
