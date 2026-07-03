"""
字幕なしのハンドリング（S5: statusベースの恒久失敗記録）と、
dry-runが本当に無課金であること（S6: dry_run分岐をsummarize()呼び出しより前に移動）を検証する。
"""

from unittest.mock import MagicMock

from get_transcript import TranscriptResult

from conftest import make_fake_gemini, make_stream_row

import reprocess_videos


def test_no_subtitle_real_run_marks_transcript_failed(monkeypatch, fake_supabase):
    row = make_stream_row(transcript="")  # DB上にも既存transcriptが無い
    fake_supabase.seed("streams", row)
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(text="", snippets=[], source="failed"),
    )

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=False)

    assert result is False
    stream_updates = [c for c in fake_supabase.update_calls if c["table"] == "streams"]
    assert len(stream_updates) == 1
    assert stream_updates[0]["payload"] == {"status": "transcript_failed"}
    assert fake_supabase.db["streams"][0]["status"] == "transcript_failed"


def test_no_subtitle_dry_run_makes_no_db_write(monkeypatch, fake_supabase):
    row = make_stream_row(transcript="")
    fake_supabase.seed("streams", row)
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(text="", snippets=[], source="failed"),
    )

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=True)

    assert result is False
    assert fake_supabase.update_calls == []
    assert fake_supabase.db["streams"][0]["status"] == "public"  # 変化していない


def test_transcript_failed_row_is_excluded_from_next_default_targets(fake_supabase, monkeypatch):
    """字幕なしでtranscript_failedに更新された行は、次回デフォルト実行の対象から除外される。"""
    failed_row = make_stream_row(
        id="stream-failed", video_id="vid-failed", ai_prompt_ver=None, status="transcript_failed"
    )
    normal_row = make_stream_row(id="stream-normal", video_id="vid-normal", ai_prompt_ver=None)
    fake_supabase.seed("streams", failed_row, normal_row)

    seen = []
    monkeypatch.setattr(
        reprocess_videos,
        "reprocess_one",
        lambda supabase, gemini, row, dry_run, force=False, refetch=False: seen.append(row["video_id"]) or True,
    )
    monkeypatch.setattr(reprocess_videos, "get_supabase_client", lambda: fake_supabase)
    monkeypatch.setattr(reprocess_videos, "get_gemini_client", lambda: object())
    monkeypatch.setattr(reprocess_videos.time, "sleep", lambda *_: None)

    reprocess_videos.run()

    assert seen == ["vid-normal"]


def test_fetch_failure_with_existing_transcript_text_falls_back_without_marking_failed(monkeypatch, fake_supabase):
    """新規取得は失敗しても、streams.transcriptに既存テキストがあれば失敗扱いにせず処理を続ける。"""
    row = make_stream_row(transcript="既存の字幕テキストがすでにある")
    fake_supabase.seed("streams", row)
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(text="", snippets=[], source="failed"),
    )

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=True)

    assert result is True  # dry-runの「処理対象になった」扱い
    assert fake_supabase.update_calls == []
    assert fake_supabase.db["streams"][0]["status"] == "public"  # transcript_failedになっていない


def test_dry_run_reprocess_one_never_calls_summarize(monkeypatch, fake_supabase):
    row = make_stream_row()
    fake_supabase.seed("streams", row)
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(
            text="ダミー字幕", snippets=[{"text": "hello", "start": 0}], source="youtube_api"
        ),
    )
    summarize_mock = MagicMock()
    monkeypatch.setattr(reprocess_videos, "summarize", summarize_mock)

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=True)

    assert result is True
    summarize_mock.assert_not_called()
    assert fake_supabase.update_calls == []
    assert fake_supabase.insert_calls == []


def test_run_dry_run_never_calls_gemini_generate_content(monkeypatch, fake_supabase):
    """summarize()をモックせず、Geminiクライアント本体のgenerate_contentが
    dry-run実行では一度も呼ばれないことを、より実運用に近い形で確認する。"""
    row = make_stream_row(video_id="vid-1")
    fake_supabase.seed("streams", row)

    monkeypatch.setattr(reprocess_videos, "get_supabase_client", lambda: fake_supabase)
    gemini = make_fake_gemini()
    monkeypatch.setattr(reprocess_videos, "get_gemini_client", lambda: gemini)
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(
            text="ダミー字幕", snippets=[{"text": "hello", "start": 0}], source="youtube_api"
        ),
    )
    monkeypatch.setattr(reprocess_videos.time, "sleep", lambda *_: None)

    reprocess_videos.run(dry_run=True, target_video_id="vid-1")

    gemini.models.generate_content.assert_not_called()
    assert fake_supabase.update_calls == []
