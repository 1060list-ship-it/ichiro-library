"""Offline route smoke tests; FakeSupabase is not evidence of SQL behavior."""
import pytest
import batch_runner
import fetch_new_videos
import get_transcript
import reprocess_videos
import store
import summarize
import whisper_transcribe
from conftest import make_ai_result, make_stream_row

META = {'video_id': 'vid-1', 'title': 'title', 'stream_date': '2026-01-01'}
SNIPPETS = [{'text': 'hello', 'start': 0}]

@pytest.fixture
def stubs(monkeypatch):
    result = get_transcript.TranscriptResult(text='hello', snippets=SNIPPETS, source='youtube_api')
    monkeypatch.setattr(batch_runner, 'get_transcript', lambda *_: result)
    monkeypatch.setattr(batch_runner, 'build_timestamped_text', lambda *_: 'hello')
    monkeypatch.setattr(batch_runner, 'summarize', lambda *a, **k: make_ai_result(chapters=[]))
    monkeypatch.setattr(batch_runner, 'save_transcript_snapshot', lambda *a, **k: None)
    monkeypatch.setattr(store, '_ai_metadata', lambda _: ('model', 'version'))
    monkeypatch.setattr(store, 'normalize_tags', lambda *a, **k: [])
    monkeypatch.setattr(whisper_transcribe, 'transcribe_video', lambda *_: ('hello', SNIPPETS))
    monkeypatch.setattr(fetch_new_videos, 'get_youtube_client', lambda: object())
    monkeypatch.setattr(fetch_new_videos, '_fetch_video_details', lambda *a: [META])
    monkeypatch.setattr(summarize, 'get_gemini_client', lambda: object())
    monkeypatch.setattr(summarize, 'summarize', lambda *a, **k: make_ai_result(chapters=[]))
    monkeypatch.setattr(get_transcript, 'build_timestamped_text', lambda *_: 'hello')
    monkeypatch.setattr(store, 'save_transcript_snapshot', lambda *a, **k: None)
    monkeypatch.setattr(reprocess_videos, 'get_transcript', lambda *_: result)
    monkeypatch.setattr(reprocess_videos, 'build_timestamped_text', lambda *_: 'hello')
    monkeypatch.setattr(reprocess_videos, 'summarize', lambda *a, **k: make_ai_result(chapters=[]))
    monkeypatch.setattr(reprocess_videos, 'save_transcript_snapshot', lambda *a, **k: None)

@pytest.mark.parametrize('route', ['process', 'single', 'whisper', 'reprocess'])
def test_route_calls_save_rpc(fake_supabase, monkeypatch, stubs, route):
    if route == 'process':
        assert batch_runner.process_video(META, object(), fake_supabase)
    elif route == 'single':
        monkeypatch.setattr(batch_runner, 'get_youtube_client', lambda: object())
        monkeypatch.setattr(batch_runner, 'get_supabase_client', lambda: fake_supabase)
        monkeypatch.setattr(batch_runner, 'get_gemini_client', lambda: object())
        monkeypatch.setattr(batch_runner, '_fetch_video_details', lambda *a: [META])
        batch_runner.run_single('vid-1')
    elif route == 'whisper':
        whisper_transcribe.transcribe_and_store(fake_supabase, 'vid-1')
    else:
        row = make_stream_row()
        fake_supabase.seed('streams', row)
        assert reprocess_videos.reprocess_one(fake_supabase, object(), row, False)
    assert [call['fn'] for call in fake_supabase.rpc_calls] == ['save_generated_summary']
    assert fake_supabase.db['streams'][0]['summary'] == '要約テキスト'


def test_whisper_no_summarize_never_calls_save(fake_supabase, monkeypatch, stubs):
    fake_supabase.seed('streams', make_stream_row())
    whisper_transcribe.transcribe_and_store(fake_supabase, 'vid-1', no_summarize=True)
    assert fake_supabase.rpc_calls == []
