import summary_review as review


def test_first_save_only(monkeypatch):
    calls = []
    monkeypatch.setattr(review, 'consume_review_run', lambda *a, **k: calls.append((a, k)))
    base = {'stream_id': 's', 'review_run_id': 'r', 'was_first_summary_success': True, 'is_review_locked': False}
    review.consume_first_saved(None, base, model='model', snapshot_id='snap')
    assert len(calls) == 1 and calls[0][1]['snapshot_id'] == 'snap'
    for change in ({'was_first_summary_success': False}, {'was_first_summary_success': None}, {'review_run_id': None}, {'is_review_locked': True}):
        review.consume_first_saved(None, dict(base, **change))
    assert len(calls) == 1


def test_review_exception_does_not_propagate(monkeypatch):
    def fail(*args, **kwargs): raise RuntimeError('failure')
    monkeypatch.setattr(review, 'consume_review_run', fail)
    result = review.consume_first_saved(None, {'stream_id': 's', 'review_run_id': 'r', 'was_first_summary_success': True, 'is_review_locked': False})
    assert result == {'state': 'unknown'}


def test_batch_and_single_route_after_chapters(monkeypatch):
    import dotenv
    monkeypatch.setattr(dotenv, 'load_dotenv', lambda *a, **k: None)
    import batch_runner as batch
    from types import SimpleNamespace
    order = []
    monkeypatch.setattr(batch, 'get_existing_stream', lambda *a: None)
    monkeypatch.setattr(batch, 'get_transcript', lambda *a: SimpleNamespace(source='ok', text='x', snippets=[{'text': 'x', 'start': 0}]))
    monkeypatch.setattr(batch, 'summarize', lambda *a, **k: {'summary': 's', 'chapters': [1]})
    monkeypatch.setattr(batch, 'upsert_stream', lambda **k: {'stream_id': 's', 'is_review_locked': False, 'was_first_summary_success': True, 'review_run_id': 'r'})
    monkeypatch.setattr(batch, 'save_transcript_snapshot', lambda *a: order.append('snapshot') or 'snap')
    monkeypatch.setattr(batch, 'insert_chapters', lambda *a, **k: order.append('chapters'))
    monkeypatch.setattr(review, 'consume_review_run', lambda *a, **k: order.append('review'))
    assert batch.process_video({'video_id': 'v'}, None, None)
    assert order == ['snapshot', 'chapters', 'review']
    order.clear(); batch.process_video({'video_id': 'v'}, None, None, dry_run=True); assert order == []
    monkeypatch.setattr(batch, 'get_youtube_client', lambda: None)
    monkeypatch.setattr(batch, 'get_supabase_client', lambda: None)
    monkeypatch.setattr(batch, 'get_gemini_client', lambda: None)
    monkeypatch.setattr(batch, '_fetch_video_details', lambda *a: [{'video_id': 'v'}])
    batch.run_single('v'); assert order == ['snapshot', 'chapters', 'review']


def test_reprocess_route_after_metadata(monkeypatch, fake_supabase):
    import reprocess_videos as mod
    from conftest import make_stream_row, make_ai_result
    from get_transcript import TranscriptResult
    row = make_stream_row(); fake_supabase.seed('streams', row)
    events = []
    monkeypatch.setattr(mod, '_get_latest_transcript_snapshot', lambda *a: ('snap', TranscriptResult(text='text', snippets=[{'text': 'text', 'start': 0}], source='snapshot')))
    monkeypatch.setattr(mod, 'summarize', lambda *a, **k: make_ai_result(chapters=[]))
    monkeypatch.setattr(mod, 'save_generated_summary', lambda *a: {'stream_id': row['id'], 'is_review_locked': False, 'was_first_summary_success': True, 'review_run_id': 'r'})
    monkeypatch.setattr(review, 'consume_review_run', lambda *a, **k: events.append((len(fake_supabase.update_calls), k['snapshot_id'])))
    assert mod.reprocess_one(fake_supabase, None, row, dry_run=False)
    assert events and events[0][0] > 0 and events[0][1] == 'snap'


def test_whisper_route_and_early_exits(monkeypatch):
    import whisper_transcribe as mod
    import fetch_new_videos, summarize, store
    events = []
    monkeypatch.setattr(mod, 'transcribe_video', lambda *a: ('text', [{'text': 'text', 'start': 0}]))
    monkeypatch.setattr(fetch_new_videos, 'get_youtube_client', lambda: None)
    monkeypatch.setattr(fetch_new_videos, '_fetch_video_details', lambda *a: [{'video_id': 'v'}])
    monkeypatch.setattr(summarize, 'get_gemini_client', lambda: None)
    monkeypatch.setattr(summarize, 'summarize', lambda *a, **k: {'summary': 's', 'chapters': [1]})
    monkeypatch.setattr(store, 'get_existing_stream', lambda *a: None)
    monkeypatch.setattr(store, 'upsert_stream', lambda **k: {'stream_id': 's', 'is_review_locked': False, 'was_first_summary_success': True, 'review_run_id': 'r'})
    monkeypatch.setattr(store, 'save_transcript_snapshot', lambda *a: events.append('snapshot') or 'snap')
    monkeypatch.setattr(store, 'insert_chapters', lambda *a, **k: events.append('chapters'))
    monkeypatch.setattr(store, 'update_transcript', lambda *a, **k: events.append('transcript'))
    monkeypatch.setattr(review, 'consume_review_run', lambda *a, **k: events.append('review'))
    mod.transcribe_and_store(None, 'v'); assert events == ['snapshot', 'chapters', 'review']
    events.clear(); mod.transcribe_and_store(None, 'v', no_summarize=True); assert events == ['transcript']
    events.clear(); mod.transcribe_and_store(None, 'v', dry_run=True); assert not events


def test_real_routes_skip_non_first_and_locked(monkeypatch, fake_supabase):
    import dotenv
    monkeypatch.setattr(dotenv, 'load_dotenv', lambda *a, **k: None)
    import batch_runner as batch, reprocess_videos as reprocess, whisper_transcribe as whisper
    import fetch_new_videos, summarize, store
    from types import SimpleNamespace
    from conftest import make_stream_row, make_ai_result
    from get_transcript import TranscriptResult
    calls = []
    monkeypatch.setattr(review, 'consume_review_run', lambda *a, **k: calls.append(1))
    monkeypatch.setattr(batch, 'get_existing_stream', lambda *a: None)
    monkeypatch.setattr(batch, 'get_transcript', lambda *a: SimpleNamespace(source='ok', text='x', snippets=[{'text': 'x', 'start': 0}]))
    monkeypatch.setattr(batch, 'summarize', lambda *a, **k: {'summary': 's', 'chapters': []})
    monkeypatch.setattr(batch, 'save_transcript_snapshot', lambda *a: 'snap')
    monkeypatch.setattr(batch, 'insert_chapters', lambda *a, **k: None)
    monkeypatch.setattr(batch, 'get_youtube_client', lambda: None)
    monkeypatch.setattr(batch, 'get_supabase_client', lambda: None)
    monkeypatch.setattr(batch, 'get_gemini_client', lambda: None)
    monkeypatch.setattr(batch, '_fetch_video_details', lambda *a: [{'video_id': 'v'}])
    row = make_stream_row(); fake_supabase.seed('streams', row)
    monkeypatch.setattr(reprocess, '_get_latest_transcript_snapshot', lambda *a: ('snap', TranscriptResult(text='text', snippets=[{'text': 'text', 'start': 0}], source='snapshot')))
    monkeypatch.setattr(reprocess, 'summarize', lambda *a, **k: make_ai_result(chapters=[]))
    monkeypatch.setattr(whisper, 'transcribe_video', lambda *a: ('text', [{'text': 'text', 'start': 0}]))
    monkeypatch.setattr(fetch_new_videos, 'get_youtube_client', lambda: None)
    monkeypatch.setattr(fetch_new_videos, '_fetch_video_details', lambda *a: [{'video_id': 'v'}])
    monkeypatch.setattr(summarize, 'get_gemini_client', lambda: None)
    monkeypatch.setattr(summarize, 'summarize', lambda *a, **k: {'summary': 's', 'chapters': []})
    monkeypatch.setattr(store, 'get_existing_stream', lambda *a: None)
    monkeypatch.setattr(store, 'save_transcript_snapshot', lambda *a: 'snap')
    monkeypatch.setattr(store, 'insert_chapters', lambda *a, **k: None)
    for first, locked in [(False, False), (None, False), (True, True)]:
        saved = {'stream_id': row['id'], 'review_run_id': 'r', 'was_first_summary_success': first, 'is_review_locked': locked}
        monkeypatch.setattr(batch, 'upsert_stream', lambda **k: saved)
        monkeypatch.setattr(store, 'upsert_stream', lambda **k: saved)
        monkeypatch.setattr(reprocess, 'save_generated_summary', lambda *a: saved)
        batch.process_video({'video_id': 'v'}, None, None)
        batch.run_single('v')
        reprocess.reprocess_one(fake_supabase, None, row, dry_run=False)
        whisper.transcribe_and_store(None, 'v')
    assert calls == []
