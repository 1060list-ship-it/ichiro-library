import copy
import json
import httpx
from types import SimpleNamespace

import summary_review as review


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, {}
    def select(self, *_): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def limit(self, *_): return self
    def execute(self):
        if self.db.down: raise RuntimeError('offline')
        rows = [x for x in self.db.tables.get(self.table, []) if all(x.get(k) == v for k, v in self.filters.items())]
        return SimpleNamespace(data=copy.deepcopy(rows[:1]))


class DB:
    def __init__(self, summary='誤名の話', transcript='誤名（正式名:おたま座）'):
        self.tables = {'summary_review_runs': [{'review_run_id': 'r', 'stream_id': 's', 'state': 'pending', 'input_summary': summary, 'input_transcript': transcript}],
                       'transcript_snapshots': [{'id': 'snap', 'stream_id': 's', 'snippets': [{'text': transcript}]}]}
        self.calls, self.down, self.lost = [], False, False
    def table(self, name): return Query(self, name)
    def rpc(self, name, payload):
        self.calls.append((name, copy.deepcopy(payload)))
        def execute():
            run = self.tables['summary_review_runs'][0]
            if name.startswith('claim'):
                run.update(state='running', attempt_id=payload['p_attempt_id'])
                return SimpleNamespace(data={'state': 'running', 'claimed': True, 'attempt_id': payload['p_attempt_id']})
            if self.lost:
                self.lost = False
                raise httpx.ReadError('lost')
            run.update(state='failed' if payload['p_new_status'] == 'review_failed' else 'succeeded', result_payload={'summary': payload['p_summary_text'], 'status': payload['p_new_status'], 'findings': copy.deepcopy(payload['p_findings'])})
            return SimpleNamespace(data={'state': run['state'], 'replayed': False})
        return SimpleNamespace(execute=execute)


def candidate(before='誤名', after='おたま座', quote='誤名（正式名:おたま座）'):
    return {'candidates': [{'before': before, 'after': after, 'snippet_index': 0, 'quote': quote}]}


def run(db, raw, source=None, snapshot='snap'):
    calls = []
    def extract(*args): calls.append(1); return raw
    result = review.consume_review_run(db, 'r', 's', snapshot_id=snapshot, candidate_extractor=extract, official_source=source)
    return result, calls, db.calls[-1][1] if len(db.calls) > 1 else None


def test_catalog_high_and_stable_text_evidence():
    db = DB(); result, calls, payload = run(db, candidate())
    assert result['state'] == 'succeeded' and calls == [1]
    assert payload['p_new_status'] == 'auto_fixed' and payload['p_summary_text'] == 'おたま座の話'
    finding = payload['p_findings'][0]; evidence = json.loads(finding['evidence'])
    assert finding['confidence'] == 'high' and evidence['snapshot_id'] == 'snap'
    assert evidence['catalog']['path'].endswith('entity_catalog.txt') and len(evidence['catalog']['sha256']) == 64


def test_zero_invalid_and_no_reclaim():
    db = DB(); _, calls, payload = run(db, {'candidates': []})
    assert calls == [1] and payload['p_new_status'] == 'reviewed_no_change'
    _, calls, _ = run(db, candidate()); assert calls == []
    db = DB(); _, _, payload = run(db, '{bad')
    assert payload['p_new_status'] == 'review_failed' and payload['p_findings'] == []
    db = DB(); db.tables['summary_review_runs'][0]['state'] = 'running'
    _, calls, _ = run(db, candidate()); assert calls == [] and not db.calls


def test_low_for_partial_catalog_snapshot_and_multiple_occurrences():
    for db, c, snap in [(DB(), candidate(after='おたま'), 'snap'), (DB(), candidate(), None),
                        (DB(summary='誤名と誤名'), candidate(), 'snap'),
                        (DB(transcript='誤名だけ'), candidate(quote='誤名だけ'), 'snap')]:
        _, _, p = run(db, c, snapshot=snap)
        assert p['p_new_status'] == 'needs_review' and p['p_summary_text'] == db.tables['summary_review_runs'][0]['input_summary']
        assert p['p_findings'][0]['before_text'] == p['p_findings'][0]['after_text']


def test_official_source_requires_explicit_trust_and_exact_document():
    quote = '誤名（正式名:公式名）'; db = DB(transcript=quote)
    class Source:
        trusted_urls = {'https://official.example/post'}
        def __call__(self, stream):
            return {'url': 'https://official.example/post', 'retrieved_at': '2026-01-01T12:00:00+09:00', 'text': quote,
                    'quote': quote, 'start': 0, 'end': len(quote), 'stream_id': stream, 'official_name': '公式名'}
    _, _, p = run(db, candidate(after='公式名', quote=quote), Source())
    assert p['p_new_status'] == 'auto_fixed'
    assert json.loads(p['p_findings'][0]['evidence'])['official']['url'] == 'https://official.example/post'
    for change in ('url', 'retrieved_at', 'quote', 'stream_id'):
        class Bad(Source):
            def __call__(self, stream):
                d = super().__call__(stream); d[change] = {'url': 'https://fake.example/', 'retrieved_at': '2026-01-01', 'quote': '', 'stream_id': 'other'}[change]; return d
        _, _, p = run(DB(transcript=quote), candidate(after='公式名', quote=quote), Bad())
        assert p['p_new_status'] == 'needs_review'


def test_retry_same_payload_and_unknown():
    db = DB(); db.lost = True
    _, calls, p = run(db, candidate())
    assert calls == [1] and db.calls[-1] == db.calls[-2] and p['p_new_status'] == 'auto_fixed'
    db = DB(); db.down = True
    assert review.consume_review_run(db, 'r', 's')['state'] == 'unknown' and not db.calls


def test_mixed_candidates_and_official_unavailable():
    text = '誤名（正式名:おたま座） 別名だけ'
    db = DB(summary='誤名と別名', transcript=text)
    candidates = {'candidates': [candidate(quote=text)['candidates'][0],
                                  candidate('別名', '未知名', text)['candidates'][0]]}
    def unavailable(_): raise OSError('unavailable')
    _, _, p = run(db, candidates, unavailable)
    assert p['p_new_status'] == 'needs_review' and p['p_summary_text'] == 'おたま座と別名'
    assert [f['confidence'] for f in p['p_findings']] == ['high', 'low']


def test_verifier_exception_and_conflicts(monkeypatch):
    monkeypatch.setattr(review, '_catalogs', lambda: (_ for _ in ()).throw(ValueError('bad catalog')))
    _, _, p = run(DB(), candidate())
    assert p['p_new_status'] == 'review_failed' and p['p_findings'] == []


def test_commit_lost_after_success_is_queried_without_retry():
    db = DB()
    original = db.rpc
    def rpc(name, payload):
        if name.startswith('commit'):
            db.calls.append((name, copy.deepcopy(payload)))
            def lost():
                db.tables['summary_review_runs'][0].update(state='succeeded', result_payload={'summary': payload['p_summary_text'], 'status': payload['p_new_status'], 'findings': copy.deepcopy(payload['p_findings'])})
                raise httpx.ReadTimeout('lost')
            return SimpleNamespace(execute=lost)
        return original(name, payload)
    db.rpc = rpc
    result, calls, _ = run(db, candidate())
    assert result == {'state': 'succeeded', 'recovered': True} and calls == [1] and len(db.calls) == 2


def test_verified_snippet_boundaries_reach_default_model():
    db = DB(transcript='前 誤名（正式名:おたま座）')
    db.tables['transcript_snapshots'][0]['snippets'] = [{'text': '前'}, {'text': '誤名（正式名:おたま座）'}]
    class Models:
        def generate_content(self, **kwargs):
            data = json.loads(kwargs['contents'].split('\n', 1)[1])
            assert data['snippets'] == [{'snippet_index': 0, 'text': '前'}, {'snippet_index': 1, 'text': '誤名（正式名:おたま座）'}]
            return SimpleNamespace(text=json.dumps({'candidates': []}))
    assert review.consume_review_run(db, 'r', 's', snapshot_id='snap', model=SimpleNamespace(models=Models()))['state'] == 'succeeded'


def test_claim_rejections_and_terminal_skip_extraction():
    for claim in ({'claimed': False, 'state': 'running'}, {'claimed': True, 'state': 'running', 'attempt_id': 'other'}):
        db = DB()
        db.rpc = lambda name, payload: SimpleNamespace(execute=lambda: SimpleNamespace(data=claim))
        result, calls, _ = run(db, candidate())
        assert result['claimed'] is False and calls == []
    db = DB(); db.tables['summary_review_runs'][0]['state'] = 'succeeded'
    assert run(db, candidate())[1] == [] and not db.calls


def test_snapshot_wrong_stream_or_full_text_never_high():
    for field, value in [('stream_id', 'other'), ('snippets', [{'text': 'different'}])]:
        db = DB(); db.tables['transcript_snapshots'][0][field] = value
        _, _, p = run(db, candidate())
        assert p['p_findings'][0]['confidence'] == 'low' and p['p_summary_text'] == '誤名の話'


def test_commit_contract_errors_do_not_retry():
    for error in ('obsolete_attempt', 'terminal_payload_changed'):
        db = DB(); original = db.rpc
        def rpc(name, payload):
            if name.startswith('commit'):
                db.calls.append((name, copy.deepcopy(payload)))
                def reject(): raise ValueError(error)
                return SimpleNamespace(execute=reject)
            return original(name, payload)
        db.rpc = rpc
        result, calls, _ = run(db, candidate())
        assert result['state'] == 'unknown' and calls == [1] and len(db.calls) == 2


def test_lost_terminal_payload_mismatch_and_stale():
    for state, matches in [('succeeded', False), ('stale', True)]:
        db = DB(); original = db.rpc
        def rpc(name, payload):
            if name.startswith('commit'):
                db.calls.append((name, copy.deepcopy(payload)))
                def lost():
                    fixed = {'summary': payload['p_summary_text'], 'status': payload['p_new_status'], 'findings': copy.deepcopy(payload['p_findings'])}
                    if not matches: fixed['summary'] = 'other'
                    db.tables['summary_review_runs'][0].update(state=state, result_payload=fixed)
                    raise httpx.ReadError('lost')
                return SimpleNamespace(execute=lost)
            return original(name, payload)
        db.rpc = rpc
        result, calls, _ = run(db, candidate())
        assert result['state'] == ('stale' if matches else 'unknown') and calls == [1] and len(db.calls) == 2


def test_retry_connection_loss_is_unknown_without_reextract():
    db = DB(); original = db.rpc
    def rpc(name, payload):
        if name.startswith('commit'):
            db.calls.append((name, copy.deepcopy(payload)))
            def lost(): raise httpx.ReadError('lost')
            return SimpleNamespace(execute=lost)
        return original(name, payload)
    db.rpc = rpc
    result, calls, _ = run(db, candidate())
    assert result['state'] == 'unknown' and calls == [1] and len(db.calls) == 3 and db.calls[-1] == db.calls[-2]
