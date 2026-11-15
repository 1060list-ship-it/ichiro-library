from types import SimpleNamespace
import httpx
import pytest
import official_review_sources as sources
import summary_review as review
from test_summary_review import DB


@pytest.mark.parametrize('route', ['batch', 'single', 'reprocess', 'whisper'])
def test_default_factory_reaches_commit(route, monkeypatch):
    import dotenv
    monkeypatch.setattr(dotenv, 'load_dotenv', lambda *a, **k: None)
    import batch_runner as batch, reprocess_videos as rep, whisper_transcribe as whisper
    import store, summarize, fetch_new_videos
    from get_transcript import TranscriptResult
    from conftest import make_ai_result
    text = '出演は山口一郎です'
    db = DB(summary='出演は山口一朗です', transcript=text)
    calls = []
    original = httpx.Client
    def handler(request):
        assert db.calls and db.calls[0][0] == 'claim_summary_review_run'
        calls.append(str(request.url))
        return httpx.Response(200, text='<p>山口一郎</p>')
    monkeypatch.setattr(sources.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    candidate = {'before': '山口一朗', 'after': '山口一郎', 'snippet_index': 0, 'quote': text}
    monkeypatch.setattr(review, '_extract', lambda *args: {'candidates': [candidate]})
    saved = {'stream_id': 's', 'review_run_id': 'r', 'was_first_summary_success': True, 'is_review_locked': False}
    result = TranscriptResult(text=text, snippets=[{'text': text, 'start': 0}], source='ok')
    monkeypatch.setattr(batch, 'get_existing_stream', lambda *a: None)
    monkeypatch.setattr(batch, 'get_transcript', lambda *a: result)
    monkeypatch.setattr(batch, 'summarize', lambda *a, **k: {'summary': 'x', 'chapters': []})
    monkeypatch.setattr(batch, 'upsert_stream', lambda **k: saved)
    monkeypatch.setattr(batch, 'save_transcript_snapshot', lambda *a: 'snap')
    monkeypatch.setattr(batch, 'get_youtube_client', lambda: None)
    monkeypatch.setattr(batch, 'get_supabase_client', lambda: db)
    monkeypatch.setattr(batch, 'get_gemini_client', lambda: None)
    monkeypatch.setattr(batch, '_fetch_video_details', lambda *a: [{'video_id': 'v'}])
    if route == 'batch':
        batch.process_video({'video_id': 'v'}, None, db)
    elif route == 'single':
        batch.run_single('v')
    elif route == 'whisper':
        monkeypatch.setattr(whisper, 'transcribe_video', lambda *a: (text, result.snippets))
        monkeypatch.setattr(fetch_new_videos, 'get_youtube_client', lambda: None)
        monkeypatch.setattr(fetch_new_videos, '_fetch_video_details', lambda *a: [{'video_id': 'v'}])
        monkeypatch.setattr(summarize, 'get_gemini_client', lambda: None)
        monkeypatch.setattr(summarize, 'summarize', lambda *a, **k: {'summary': 'x', 'chapters': []})
        monkeypatch.setattr(store, 'get_existing_stream', lambda *a: None)
        monkeypatch.setattr(store, 'upsert_stream', lambda **k: saved)
        monkeypatch.setattr(store, 'save_transcript_snapshot', lambda *a: 'snap')
        whisper.transcribe_and_store(db, 'v')
    else:
        row = {'id': 's', 'video_id': 'v', 'is_reviewed': False}
        monkeypatch.setattr(rep, '_get_latest_transcript_snapshot', lambda *a: ('snap', result))
        monkeypatch.setattr(rep, 'get_existing_stream', lambda *a: row)
        monkeypatch.setattr(rep, 'generation_version', lambda *a: 'v')
        monkeypatch.setattr(rep, 'summarize', lambda *a, **k: make_ai_result(chapters=[]))
        monkeypatch.setattr(rep, 'save_generated_summary', lambda *a: saved)
        monkeypatch.setattr(rep, 'normalize_tags', lambda *a: [])
        original_table = db.table
        class Update:
            def update(self, *a): return self
            def eq(self, *a): return self
            def execute(self): return SimpleNamespace(data=[])
        monkeypatch.setattr(db, 'table', lambda table: Update() if table == 'streams' else original_table(table))
        rep.reprocess_one(db, None, row, False)
    assert calls == list(sources.URLS)
    payload = db.calls[-1][1]
    assert payload['p_new_status'] == 'needs_review'
    assert '"official_status":"ok"' in payload['p_findings'][0]['evidence']
    assert '"quote":"山口一郎"' in payload['p_findings'][0]['evidence']
