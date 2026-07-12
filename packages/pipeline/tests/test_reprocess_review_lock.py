"""
--video 指定時でも、レビュー済みstreamの手動編集フィールドを上書きしないことを検証する。
"""

from unittest.mock import MagicMock

from get_transcript import TranscriptResult

from conftest import make_ai_result, make_stream_row
from store import _REVIEW_LOCKED_FIELDS

import reprocess_videos


def test_video_force_normalizes_tags_against_active_vocabulary(monkeypatch, fake_supabase):
    row = make_stream_row(is_reviewed=False, tags=["relationships"])
    fake_supabase.seed("streams", row)
    fake_supabase.seed(
        "tag_vocabulary",
        {"slug": "music_production", "label": "音楽制作", "is_active": True},
        {"slug": "relationships", "label": "人間関係", "is_active": False},
    )

    ai_result = make_ai_result(tags=["relationships", "音楽制作", "unknown_tag"])
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(text="", snippets=[], source="failed"),
    )
    monkeypatch.setattr(reprocess_videos, "summarize", lambda *a, **k: ai_result)
    monkeypatch.setattr(reprocess_videos, "insert_chapters", MagicMock(return_value=1))

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=False, force=True)

    assert result is True
    stream_updates = [c for c in fake_supabase.update_calls if c["table"] == "streams"]
    assert stream_updates[0]["payload"]["tags"] == ["music_production"]


def test_video_force_reviewed_row_omits_review_locked_fields(monkeypatch, fake_supabase):
    row = make_stream_row(
        is_reviewed=True,
        summary="手動要約",
        tags=["manual-tag"],
        corner_names=["手動コーナー"],
        guests=["手動ゲスト"],
        songs=["手動曲"],
        has_live_singing=True,
        talk_topics=["手動トピック"],
        highlights=["旧ハイライト"],
    )
    fake_supabase.seed("streams", row)

    ai_result = make_ai_result(
        summary="AI要約",
        tags=["ai-tag"],
        corner_names=["AIコーナー"],
        guests=["AIゲスト"],
        songs=["AI曲"],
        has_live_singing=False,
        talk_topics=["AIトピック"],
        highlights=["新ハイライト"],
    )
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(text="", snippets=[], source="failed"),
    )
    monkeypatch.setattr(reprocess_videos, "summarize", lambda *a, **k: ai_result)
    insert_chapters_mock = MagicMock(return_value=1)
    monkeypatch.setattr(reprocess_videos, "insert_chapters", insert_chapters_mock)

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=False, force=True)

    assert result is True
    insert_chapters_mock.assert_called_once()

    stream_updates = [c for c in fake_supabase.update_calls if c["table"] == "streams"]
    assert len(stream_updates) == 1
    payload = stream_updates[0]["payload"]

    for field in _REVIEW_LOCKED_FIELDS:
        assert field not in payload

    assert payload["highlights"] == ["新ハイライト"]
    assert payload["ai_model"] == reprocess_videos.MODEL_NAME
    assert payload["ai_prompt_ver"] == reprocess_videos.TARGET_PROMPT_VER

    updated_row = fake_supabase.db["streams"][0]
    assert updated_row["summary"] == "手動要約"
    assert updated_row["tags"] == ["manual-tag"]
    assert updated_row["corner_names"] == ["手動コーナー"]
    assert updated_row["guests"] == ["手動ゲスト"]
    assert updated_row["songs"] == ["手動曲"]
    assert updated_row["has_live_singing"] is True
    assert updated_row["talk_topics"] == ["手動トピック"]
    assert updated_row["highlights"] == ["新ハイライト"]
