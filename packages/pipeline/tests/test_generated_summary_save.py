import pytest
import store
from conftest import make_stream_row, make_ai_result


@pytest.mark.parametrize("value", [None, {}, {"summary": None}, {"summary": 4}, {"summary": "  \n"}, "text"])
def test_invalid_summary_never_calls_rpc(fake_supabase, value):
    assert not store.valid_generated_summary(value)
    with pytest.raises(ValueError):
        store.save_generated_summary(fake_supabase, "stream-1", 0, value)
    assert not fake_supabase.rpc_calls


def test_save_passes_version_and_returns_rpc_dict(fake_supabase):
    fake_supabase.seed("streams", make_stream_row())
    result = store.save_generated_summary(fake_supabase, "stream-1", 0, {"summary": "new"})
    assert result["stream_id"] == "stream-1"
    assert fake_supabase.rpc_calls[0]["params"]["p_expected_version"] == 0
    assert fake_supabase.rpc_calls[0]["params"]["p_review_run_id"]
    assert fake_supabase.db["streams"][0]["summary"] == "new"


def test_reviewed_summary_is_preserved(fake_supabase):
    fake_supabase.seed("streams", make_stream_row(is_reviewed=True, summary="manual"))
    result = store.save_generated_summary(fake_supabase, "stream-1", 0, {"summary": "new"})
    assert result["is_review_locked"] is True
    assert fake_supabase.db["streams"][0]["summary"] == "manual"


def test_generation_conflict_stops():
    with pytest.raises(ValueError, match="changed"):
        store.generation_version(make_stream_row(), make_stream_row(summary_review_version=1))


def test_rpc_response_loss_is_not_retried(fake_supabase):
    fake_supabase.seed("streams", make_stream_row())
    def lost_response(params):
        raise TimeoutError("outcome unknown")
    fake_supabase.rpc_handlers["save_generated_summary"] = lost_response
    with pytest.raises(TimeoutError):
        store.save_generated_summary(fake_supabase, "stream-1", 0, {"summary": "new"})
    assert len(fake_supabase.rpc_calls) == 1
    assert not fake_supabase.update_calls


def test_upsert_never_writes_summary_or_confirmation(fake_supabase, monkeypatch):
    monkeypatch.setattr(store, "_ai_metadata", lambda _: ("model", "version"))
    meta = {"video_id": "new", "title": "title", "stream_date": "2026-01-01"}
    result = store.upsert_stream(fake_supabase, meta, "text", "youtube", make_ai_result(chapters=[]))
    payload = fake_supabase.insert_calls[0]["payload"]
    assert "summary" not in payload and "is_reviewed" not in payload
    assert result["stream_id"] == fake_supabase.db["streams"][0]["id"]

@pytest.mark.parametrize('existing', [False, True])
def test_metadata_race_stops_before_rpc(fake_supabase, monkeypatch, existing):
    from conftest import FakeQuery
    meta = {'video_id': 'vid-1', 'title': 'title', 'stream_date': '2026-01-01'}
    if existing:
        fake_supabase.seed('streams', make_stream_row(summary='old'))
    before = store.get_existing_stream(fake_supabase, 'vid-1')
    original = FakeQuery.execute
    injected = []
    def racing_execute(query):
        if query.table_name == 'streams' and query.mode in ('upsert', 'insert', 'update') and not injected:
            injected.append(True)
            if existing:
                fake_supabase.db['streams'][0].update(summary='first writer summary', transcript='new transcript', summary_review_version=1, summary_success_seen=True, is_reviewed=False)
            else:
                fake_supabase.seed('streams', make_stream_row(id='concurrent-stream', summary='first writer summary', summary_review_version=1, summary_success_seen=True, is_reviewed=False))
        return original(query)
    monkeypatch.setattr(FakeQuery, 'execute', racing_execute)
    with pytest.raises(Exception):
        store.upsert_stream(fake_supabase, meta, 'new transcript', 'youtube', make_ai_result(), before_generation=before)
    assert injected and not fake_supabase.rpc_calls
    row = fake_supabase.db['streams'][0]
    assert (row['summary'], row['summary_success_seen'], row['is_reviewed']) == ('first writer summary', True, False)


def test_existing_transcript_update_uses_returned_version(fake_supabase, monkeypatch):
    row = make_stream_row(summary_review_version=4)
    fake_supabase.seed('streams', row)
    monkeypatch.setattr(store, '_ai_metadata', lambda _: ('model', 'version'))
    result = store.upsert_stream(fake_supabase, {'video_id': 'vid-1', 'title': 'title', 'stream_date': '2026-01-01'}, 'different', 'youtube', make_ai_result(chapters=[]), before_generation=row)
    assert fake_supabase.rpc_calls[0]['params']['p_expected_version'] == 5
    assert result['stream_id'] == row['id']

@pytest.mark.parametrize('history', [None, True, False])
def test_existing_history_and_rpc_result_are_passed_through(fake_supabase, monkeypatch, history):
    row = make_stream_row(summary_success_seen=history, summary='earlier')
    fake_supabase.seed('streams', row)
    monkeypatch.setattr(store, '_ai_metadata', lambda _: ('model', 'version'))
    response = {'stream_id': row['id'], 'is_review_locked': True, 'review_run_id': 'run', 'was_first_summary_success': history}
    fake_supabase.rpc_handlers['save_generated_summary'] = lambda params: response
    result = store.upsert_stream(fake_supabase, {'video_id': 'vid-1', 'title': 'title', 'stream_date': '2026-01-01'}, row['transcript'], 'youtube', make_ai_result(chapters=[]), before_generation=row)
    assert result == response
    assert fake_supabase.db['streams'][0]['summary_success_seen'] is history
