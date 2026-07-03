"""
429（RESOURCE_EXHAUSTED）到達時に reprocess_videos.run() が
「月間上限は即中断・分間制限のみ4回リトライしてから中断」を正しく行うかの結合テスト。

summarize._generate_with_retry の実tenacityリトライを実際に動かし、
Gemini呼び出し回数と中断ログを検証する。DBはFakeSupabaseClientで完全に隔離する。
"""

import logging

import pytest
from get_transcript import TranscriptResult

from conftest import make_api_error, make_fake_gemini, make_stream_row

import reprocess_videos


def _setup_two_target_rows(fake_supabase, monkeypatch):
    """デフォルト対象になる2件のstreamsを用意し、get_transcriptを固定応答にする。"""
    row1 = make_stream_row(id="stream-1", video_id="vid-1", ai_prompt_ver=None)
    row2 = make_stream_row(id="stream-2", video_id="vid-2", ai_prompt_ver=None, stream_date="2026-07-02")
    fake_supabase.seed("streams", row1, row2)

    monkeypatch.setattr(reprocess_videos, "get_supabase_client", lambda: fake_supabase)
    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(
            text="ダミー字幕", snippets=[{"text": "こんにちは", "start": 0}], source="youtube_api"
        ),
    )
    # run()内の time.sleep(5)（行間ウェイト）をゼロにしてテストを高速化
    monkeypatch.setattr(reprocess_videos.time, "sleep", lambda *_: None)
    return row1, row2


def test_monthly_spend_cap_aborts_immediately_without_retry(monkeypatch, fake_supabase, caplog):
    row1, row2 = _setup_two_target_rows(fake_supabase, monkeypatch)
    error = make_api_error("Billing account tier spend cap reached for this project this month.")
    gemini = make_fake_gemini(generate_content_side_effect=error)
    monkeypatch.setattr(reprocess_videos, "get_gemini_client", lambda: gemini)

    with caplog.at_level(logging.ERROR, logger="reprocess"):
        with pytest.raises(SystemExit) as excinfo:
            reprocess_videos.run()

    assert excinfo.value.code == 1
    # 月間上限は should_retry_gemini_exception=False なのでリトライされず1回で中断する。
    # call_countが1のままということは、1件目の中断で全体が止まり2件目(vid-2)には
    # 到達していないことも同時に証明している（到達していれば2回以上になるはず）。
    assert gemini.models.generate_content.call_count == 1
    assert any("monthly_spend_cap" in record.message for record in caplog.records)
    # streams側には何も書き込まれていない（課金だけ発生して結果は反映されない事故を防ぐ）
    assert fake_supabase.update_calls == []


def test_per_minute_rate_limit_retries_4_times_then_aborts(monkeypatch, fake_supabase, caplog):
    row1, row2 = _setup_two_target_rows(fake_supabase, monkeypatch)
    error = make_api_error("Quota exceeded for quota metric limit: Requests per minute (RPM).")
    gemini = make_fake_gemini(generate_content_side_effect=error)
    monkeypatch.setattr(reprocess_videos, "get_gemini_client", lambda: gemini)

    with caplog.at_level(logging.ERROR, logger="reprocess"):
        with pytest.raises(SystemExit) as excinfo:
            reprocess_videos.run()

    assert excinfo.value.code == 1
    # stop_after_attempt(4) により最大4回呼ばれてから reraise される
    assert gemini.models.generate_content.call_count == 4
    assert any("per_minute_rate_limit" in record.message for record in caplog.records)
    assert fake_supabase.update_calls == []


def test_unknown_429_wording_also_aborts_without_retry(monkeypatch, fake_supabase, caplog):
    """kana AMENDMENT S7: 区別できない429は安全側に倒して即中断する（無限に近いリトライで課金を重ねない）。"""
    row1, row2 = _setup_two_target_rows(fake_supabase, monkeypatch)
    error = make_api_error("RESOURCE_EXHAUSTED")
    gemini = make_fake_gemini(generate_content_side_effect=error)
    monkeypatch.setattr(reprocess_videos, "get_gemini_client", lambda: gemini)

    with caplog.at_level(logging.ERROR, logger="reprocess"):
        with pytest.raises(SystemExit) as excinfo:
            reprocess_videos.run()

    assert excinfo.value.code == 1
    assert gemini.models.generate_content.call_count == 1
    assert any("unknown_resource_exhausted" in record.message for record in caplog.records)
