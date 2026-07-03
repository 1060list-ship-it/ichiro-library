"""
S3: chapters が全件drop（挿入0件）になった場合に、
既存chaptersを消さず、streams.ai_prompt_ver/ai_modelも刻印しないことを検証する。

2層で検証する:
  1. store.insert_chapters() 単体 — 実際のsnap判定ロジック（rpc経由）を使い、
     全dropで戻り値0・DELETE未発生を確認する
  2. reprocess_videos.reprocess_one() — insert_chaptersが0を返した場合に
     streams側の刻印処理まで到達しないことを確認する
"""

from get_transcript import TranscriptResult

from conftest import make_ai_result, make_stream_row

import reprocess_videos
import store


def test_insert_chapters_all_dropped_returns_zero_and_keeps_existing_rows(fake_supabase):
    stream_id = "stream-1"
    fake_supabase.seed("chapters", {"id": "existing-1", "stream_id": stream_id, "title": "既存のチャプター"})

    # snap判定を全てdropに固定する
    fake_supabase.rpc_handlers["transcript_snapshot_nearest_snippet_index"] = lambda params: 0
    fake_supabase.rpc_handlers["transcript_snapshot_start_sec"] = lambda params: 0
    fake_supabase.rpc_handlers["derive_snap_status"] = lambda params: "drop"

    chapters = [
        {"start_sec": 10, "title": "a", "summary": "s1"},
        {"start_sec": 20, "title": "b", "summary": "s2"},
    ]

    inserted = store.insert_chapters(fake_supabase, stream_id, chapters, snapshot_id="snap-1")

    assert inserted == 0
    assert fake_supabase.delete_calls == []  # 既存chaptersに対するDELETEが一切発生していない
    assert fake_supabase.insert_calls == []
    assert fake_supabase.db["chapters"] == [
        {"id": "existing-1", "stream_id": stream_id, "title": "既存のチャプター"}
    ]


def test_insert_chapters_partial_drop_still_inserts_survivors(fake_supabase):
    """比較対照: 一部だけdropなら生き残った分は挿入され、DELETE→INSERTが実行される。"""
    stream_id = "stream-1"
    fake_supabase.seed("chapters", {"id": "existing-1", "stream_id": stream_id, "title": "旧チャプター"})

    statuses = iter(["drop", "exact"])
    fake_supabase.rpc_handlers["transcript_snapshot_nearest_snippet_index"] = lambda params: 0
    fake_supabase.rpc_handlers["transcript_snapshot_start_sec"] = lambda params: 0
    fake_supabase.rpc_handlers["derive_snap_status"] = lambda params: next(statuses)

    chapters = [
        {"start_sec": 10, "title": "dropped", "summary": "s1"},
        {"start_sec": 20, "title": "survivor", "summary": "s2"},
    ]

    inserted = store.insert_chapters(fake_supabase, stream_id, chapters, snapshot_id="snap-1")

    assert inserted == 1
    assert len(fake_supabase.delete_calls) == 1
    survivors = [row for row in fake_supabase.db["chapters"] if row.get("title") == "survivor"]
    assert len(survivors) == 1
    assert not any(row.get("title") == "旧チャプター" for row in fake_supabase.db["chapters"])


def test_reprocess_one_does_not_stamp_version_when_chapters_insert_returns_zero(monkeypatch, fake_supabase):
    row = make_stream_row()
    fake_supabase.seed("streams", row)
    fake_supabase.seed("chapters", {"id": "existing-1", "stream_id": row["id"], "title": "既存のチャプター"})

    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(
            text="ダミー", snippets=[{"text": "hello", "start": 0}], source="youtube_api"
        ),
    )
    monkeypatch.setattr(reprocess_videos, "summarize", lambda *a, **k: make_ai_result())
    monkeypatch.setattr(reprocess_videos, "insert_chapters", lambda *a, **k: 0)

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=False)

    assert result is False
    stream_updates = [c for c in fake_supabase.update_calls if c["table"] == "streams"]
    assert stream_updates == []  # ai_prompt_ver / ai_model が刻印されていない
    assert fake_supabase.db["streams"][0]["ai_prompt_ver"] is None
    # reprocess_one自体はinsert_chaptersをモックしているのでchaptersテーブルは未変更のはず
    assert fake_supabase.db["chapters"] == [
        {"id": "existing-1", "stream_id": row["id"], "title": "既存のチャプター"}
    ]


def test_reprocess_one_empty_chapters_from_ai_never_calls_insert_chapters(monkeypatch, fake_supabase):
    """AIの応答自体にchaptersが無い（空配列）場合は、insert_chaptersに到達する前に弾かれる。"""
    row = make_stream_row()
    fake_supabase.seed("streams", row)

    monkeypatch.setattr(
        reprocess_videos,
        "get_transcript",
        lambda video_id: TranscriptResult(
            text="ダミー", snippets=[{"text": "hello", "start": 0}], source="youtube_api"
        ),
    )
    monkeypatch.setattr(reprocess_videos, "summarize", lambda *a, **k: make_ai_result(chapters=[]))

    from unittest.mock import MagicMock
    insert_chapters_mock = MagicMock(return_value=0)
    monkeypatch.setattr(reprocess_videos, "insert_chapters", insert_chapters_mock)

    result = reprocess_videos.reprocess_one(fake_supabase, object(), row, dry_run=False)

    assert result is False
    insert_chapters_mock.assert_not_called()
    assert fake_supabase.update_calls == []
