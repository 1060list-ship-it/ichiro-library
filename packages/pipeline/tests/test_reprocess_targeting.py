"""
S2/S4/S5: 対象選択クエリ（TARGET_PROMPT_VER境界・reviewed除外・恒久失敗除外・--video優先・
summary-missing-onlyの優先順位）と、処理済みカウントの整合性を検証する。

reprocess_one()自体はスタブに差し替え、「どのvideo_idが対象として選ばれたか」だけを見る。
実際の再処理内容はtest_reprocess_chapters.py / test_reprocess_transcript_and_dryrun.pyで別途検証済み。
"""

from conftest import make_stream_row

import reprocess_videos


def _install_recording_stub(monkeypatch):
    seen = []

    def stub(supabase, gemini, row, dry_run, force=False, refetch=False):
        seen.append({"video_id": row["video_id"], "force": force})
        return True

    monkeypatch.setattr(reprocess_videos, "reprocess_one", stub)
    return seen


def _common_setup(monkeypatch, fake_supabase):
    monkeypatch.setattr(reprocess_videos, "get_supabase_client", lambda: fake_supabase)
    monkeypatch.setattr(reprocess_videos, "get_gemini_client", lambda: object())
    monkeypatch.setattr(reprocess_videos.time, "sleep", lambda *_: None)


def test_default_target_selection_target_prompt_boundary_and_exclusions(monkeypatch, fake_supabase):
    target_prompt_ver = reprocess_videos.TARGET_PROMPT_VER
    rows = [
        make_stream_row(id="s-target", video_id="target-done", ai_prompt_ver=target_prompt_ver),
        make_stream_row(id="s-null", video_id="null-ver", ai_prompt_ver=None),
        make_stream_row(id="s-v2", video_id="old-ver", ai_prompt_ver="v2"),
        make_stream_row(
            id="s-reviewed-target",
            video_id="reviewed-target",
            ai_prompt_ver=target_prompt_ver,
            is_reviewed=True,
        ),
        make_stream_row(id="s-reviewed-null", video_id="reviewed-null", ai_prompt_ver=None, is_reviewed=True),
        make_stream_row(
            id="s-transcript-failed", video_id="transcript-failed", ai_prompt_ver=None, status="transcript_failed"
        ),
        make_stream_row(id="s-summary-failed", video_id="summary-failed", ai_prompt_ver="v2", status="summary_failed"),
    ]
    fake_supabase.seed("streams", *rows)
    _common_setup(monkeypatch, fake_supabase)
    seen = _install_recording_stub(monkeypatch)

    reprocess_videos.run()

    video_ids = {c["video_id"] for c in seen}
    assert video_ids == {"null-ver", "old-ver"}
    # ai_prompt_ver=TARGET_PROMPT_VERは対象外
    assert "target-done" not in video_ids
    # reviewed行はai_prompt_ver未達でも対象外
    assert "reviewed-target" not in video_ids
    assert "reviewed-null" not in video_ids
    # 恒久失敗ステータスは対象外（無限リトライ防止）
    assert "transcript-failed" not in video_ids
    assert "summary-failed" not in video_ids


def test_summary_missing_only_priority_over_version_boundary(monkeypatch, fake_supabase):
    rows = [
        # v3刻印済みだがsummaryが無い → summary-missing-onlyモードでは対象に「戻る」
        make_stream_row(id="s-1", video_id="v3-but-summary-null", ai_prompt_ver="v3", summary=None),
        # v3未達だがsummaryは埋まっている → summary-missing-onlyモードでは対象外
        make_stream_row(id="s-2", video_id="old-ver-but-summary-filled", ai_prompt_ver="v2", summary="filled"),
        # reviewedはsummary-missing-onlyでも対象外
        make_stream_row(id="s-3", video_id="reviewed-summary-null", ai_prompt_ver=None, summary=None, is_reviewed=True),
        # 恒久失敗もsummary-missing-onlyで対象外
        make_stream_row(id="s-4", video_id="failed-summary-null", ai_prompt_ver=None, summary=None, status="transcript_failed"),
    ]
    fake_supabase.seed("streams", *rows)
    _common_setup(monkeypatch, fake_supabase)
    seen = _install_recording_stub(monkeypatch)

    reprocess_videos.run(summary_missing_only=True)

    video_ids = {c["video_id"] for c in seen}
    assert video_ids == {"v3-but-summary-null"}


def test_video_flag_bypasses_all_filters_and_forces_reviewed_row(monkeypatch, fake_supabase):
    reviewed_row = make_stream_row(
        id="s-reviewed", video_id="target-video", ai_prompt_ver="v3", is_reviewed=True, status="transcript_failed"
    )
    other_row = make_stream_row(id="s-other", video_id="other-video", ai_prompt_ver=None)
    fake_supabase.seed("streams", reviewed_row, other_row)
    _common_setup(monkeypatch, fake_supabase)
    seen = _install_recording_stub(monkeypatch)

    reprocess_videos.run(target_video_id="target-video")

    # --video指定時はTARGET_PROMPT_VER/status/reviewedのどのフィルタも適用されない
    assert seen == [{"video_id": "target-video", "force": True}]


def test_count_processed_streams_counts_target_prompt_or_reviewed_but_not_permanent_failures(fake_supabase):
    target_prompt_ver = reprocess_videos.TARGET_PROMPT_VER
    rows = [
        make_stream_row(id="s-1", video_id="target-a", ai_prompt_ver=target_prompt_ver),
        make_stream_row(id="s-2", video_id="target-b", ai_prompt_ver=target_prompt_ver),
        make_stream_row(id="s-3", video_id="reviewed-null", ai_prompt_ver=None, is_reviewed=True),
        make_stream_row(id="s-4", video_id="not-done", ai_prompt_ver=None),
        make_stream_row(id="s-5", video_id="transcript-failed", ai_prompt_ver=None, status="transcript_failed"),
    ]
    fake_supabase.seed("streams", *rows)

    count = reprocess_videos._count_processed_streams(fake_supabase)

    # target-a, target-b, reviewed-null の3件。not-doneとtranscript-failedは処理済みに含まれない。
    assert count == 3


def test_reviewed_null_version_row_is_counted_done_but_never_retargeted(monkeypatch, fake_supabase):
    """
    is_reviewed=true かつ ai_prompt_ver=NULL の行は、
    _count_processed_streams では「処理済み」として数えられるが、
    デフォルトの対象選択クエリでは reviewed 除外により二度と対象に上がらない。
    この2つが矛盾しない（「完了扱いなのに永遠に再処理され続ける」が起きない）ことを確認する。
    S4のAMENDMENT申し送り事項に対応する回帰テスト。
    """
    row = make_stream_row(id="s-1", video_id="reviewed-null", ai_prompt_ver=None, is_reviewed=True)
    fake_supabase.seed("streams", row)
    _common_setup(monkeypatch, fake_supabase)
    seen = _install_recording_stub(monkeypatch)

    assert reprocess_videos._count_processed_streams(fake_supabase) == 1

    reprocess_videos.run()

    assert seen == []
