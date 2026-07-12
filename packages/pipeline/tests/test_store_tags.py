from pathlib import Path
import re

import store


EXPECTED_V4_SLUGS = {
    "life_advice",
    "love_advice",
    "music_production",
    "making_story",
    "song_explanation",
    "live_report",
    "live_staging",
    "festival",
    "tour",
    "music_industry",
    "radio",
    "ann",
    "gaming",
    "mental_health",
    "depression",
    "ai_topic",
    "philosophy",
    "social_issues",
    "fashion",
    "baseball",
    "sauna",
    "merch",
    "guest",
    "collab",
    "new_song",
}


def _read_prompt(name: str) -> list[str]:
    prompts_dir = Path(__file__).resolve().parent.parent / "prompts"
    return (prompts_dir / name).read_text(encoding="utf-8").splitlines()


def _find_heading(lines: list[str], heading: str) -> int:
    for i, line in enumerate(lines):
        if line == heading:
            return i
    raise AssertionError(f"heading not found: {heading}")


def _find_tags_example_index(lines: list[str]) -> int:
    matches = [i for i, line in enumerate(lines) if line.strip().startswith('"tags": [')]
    assert len(matches) == 1
    return matches[0]


def _extract_v4_tag_section_slugs(lines: list[str]) -> set[str]:
    start = _find_heading(lines, "### 5. tags（タグ）")
    end = _find_heading(lines, "### 6. songs（登場した楽曲名）")

    slugs: set[str] = set()
    for line in lines[start + 1:end]:
        if not line or not line[0].islower():
            continue
        if "（" not in line:
            continue
        slugs.update(re.findall(r"([a-z_]+)（", line))
    return slugs


def _seed_tag_vocabulary(fake_supabase):
    fake_supabase.seed(
        "tag_vocabulary",
        {"slug": "music_production", "label": "音楽制作", "is_active": True},
        {"slug": "guest", "label": "ゲスト", "is_active": True},
        {"slug": "inactive_tag", "label": "非アクティブ", "is_active": False},
    )


import pytest


@pytest.fixture(autouse=True)
def reset_tag_vocab_cache():
    store._TAG_VOCAB_CACHE = None
    yield
    store._TAG_VOCAB_CACHE = None


def test_normalize_tags_keeps_existing_slugs(fake_supabase):
    _seed_tag_vocabulary(fake_supabase)

    result = store.normalize_tags(fake_supabase, ["music_production", "guest"])

    assert result == ["music_production", "guest"]


def test_normalize_tags_converts_labels_to_slugs(fake_supabase):
    _seed_tag_vocabulary(fake_supabase)

    result = store.normalize_tags(fake_supabase, ["音楽制作"])

    assert result == ["music_production"]


def test_normalize_tags_drops_unknown_tags_with_warning(fake_supabase, caplog):
    _seed_tag_vocabulary(fake_supabase)

    with caplog.at_level("WARNING"):
        result = store.normalize_tags(fake_supabase, ["山口一郎", "music_production"])

    assert result == ["music_production"]
    assert "未知タグを破棄: 山口一郎" in caplog.text


def test_normalize_tags_deduplicates_slug_and_label_aliases(fake_supabase):
    _seed_tag_vocabulary(fake_supabase)

    result = store.normalize_tags(fake_supabase, ["music_production", "音楽制作"])

    assert result == ["music_production"]


def test_normalize_tags_returns_empty_list_for_empty_input(fake_supabase):
    _seed_tag_vocabulary(fake_supabase)

    assert store.normalize_tags(fake_supabase, []) == []


@pytest.mark.parametrize("raw_tags", [None, "music_production"])
def test_normalize_tags_returns_empty_list_for_non_list_input(fake_supabase, raw_tags):
    _seed_tag_vocabulary(fake_supabase)

    assert store.normalize_tags(fake_supabase, raw_tags) == []


def test_normalize_tags_drops_non_string_elements(fake_supabase, caplog):
    _seed_tag_vocabulary(fake_supabase)

    with caplog.at_level("WARNING"):
        result = store.normalize_tags(fake_supabase, ["music_production", 123, "ゲスト"])

    assert result == ["music_production", "guest"]
    assert "未知タグを破棄: 123" in caplog.text


def test_new_stream_create_hard_rejects_invalid_tags_before_upsert(fake_supabase, caplog):
    _seed_tag_vocabulary(fake_supabase)
    video_meta = {
        "video_id": "new-video",
        "title": "new stream",
        "stream_date": "2026-07-12",
    }
    ai_result = {
        "summary": "summary",
        "tags": ["music_production", "unknown_tag"],
    }

    with caplog.at_level("WARNING"), pytest.raises(ValueError, match="invalid tags for new stream"):
        store.upsert_stream(fake_supabase, video_meta, "transcript", "youtube", ai_result)

    assert fake_supabase.upsert_calls == []
    assert "pipeline_tag_update_rejected" in caplog.text
    assert "rejected_tag=unknown_tag" in caplog.text


def test_new_stream_create_uses_common_tag_normalizer(fake_supabase, monkeypatch):
    _seed_tag_vocabulary(fake_supabase)
    monkeypatch.setattr(store, "_ai_metadata", lambda ai_result: ("model", "v4"))
    video_meta = {
        "video_id": "new-video",
        "title": "new stream",
        "stream_date": "2026-07-12",
    }
    ai_result = {
        "summary": "summary",
        "tags": ["音楽制作", "guest"],
    }

    store.upsert_stream(fake_supabase, video_meta, "transcript", "youtube", ai_result)

    assert fake_supabase.upsert_calls[0]["payload"]["tags"] == ["music_production", "guest"]


def test_normalize_tags_uses_cached_vocabulary_within_process(fake_supabase):
    _seed_tag_vocabulary(fake_supabase)

    first = store.normalize_tags(fake_supabase, ["音楽制作"])
    second = store.normalize_tags(fake_supabase, ["ゲスト"])

    assert first == ["music_production"]
    assert second == ["guest"]
    tag_vocab_queries = [
        call for call in fake_supabase.calls
        if call.table == "tag_vocabulary" and call.mode == "select"
    ]
    assert len(tag_vocab_queries) == 1


def test_v4_prompt_tag_section_contains_expected_25_slugs():
    v4_lines = _read_prompt("v4.txt")

    assert _extract_v4_tag_section_slugs(v4_lines) == EXPECTED_V4_SLUGS


def test_v4_prompt_diff_is_limited_to_tag_section_and_example_tags_line():
    v3_lines = _read_prompt("v3.txt")
    v4_lines = _read_prompt("v4.txt")

    v3_tag_start = _find_heading(v3_lines, "### 5. tags（タグ）")
    v3_song_start = _find_heading(v3_lines, "### 6. songs（登場した楽曲名）")
    v4_tag_start = _find_heading(v4_lines, "### 5. tags（タグ）")
    v4_song_start = _find_heading(v4_lines, "### 6. songs（登場した楽曲名）")

    assert v3_lines[:v3_tag_start] == v4_lines[:v4_tag_start]

    v3_suffix = v3_lines[v3_song_start:]
    v4_suffix = v4_lines[v4_song_start:]
    v3_tags_line = _find_tags_example_index(v3_suffix)
    v4_tags_line = _find_tags_example_index(v4_suffix)

    v3_without_tags_line = v3_suffix[:v3_tags_line] + v3_suffix[v3_tags_line + 1:]
    v4_without_tags_line = v4_suffix[:v4_tags_line] + v4_suffix[v4_tags_line + 1:]

    assert v3_without_tags_line == v4_without_tags_line
