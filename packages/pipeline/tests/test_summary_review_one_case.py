import copy
import json
import socket
from pathlib import Path
from types import SimpleNamespace

import pytest
import summary_review as review
import official_review_sources as sources
from test_summary_review import DB

DATA = json.loads((Path(__file__).parent / 'fixtures/summary_review_one_case/original.json').read_text())
RULE = json.loads((Path(review.__file__).parent / 'summary_review_cases.json').read_text())[0]

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(socket.socket, 'connect', lambda *a, **k: (_ for _ in ()).throw(AssertionError('network forbidden')))

class Response:
    status_code = 200
    def __init__(self, text): self.text = text
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def iter_bytes(self): yield ('<p>' + self.text + '</p>').encode()

class HTTP:
    def __init__(self, text): self.text, self.calls = text, []
    def __call__(self, **kwargs):
        assert kwargs == dict(timeout=5.0, follow_redirects=False, verify=True, trust_env=False)
        return self
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def stream(self, method, url, headers):
        self.calls.append((method, url))
        assert method == 'GET' and url in (*sources.URLS, RULE['url']) and headers == {'Accept': 'text/html'}
        if self.text is None: raise sources.httpx.ConnectError('offline')
        return Response(self.text)

class ContractDB(DB):
    def rpc(self, name, payload):
        rpc = super().rpc(name, payload)
        if name != 'commit_summary_review_run':
            return rpc
        def execute():
            low = [f for f in payload['p_findings'] if f['confidence'] == 'low']
            if any(f['before_text'] != f['after_text'] for f in low):
                raise ValueError('summary_review: low_change')
            if payload['p_new_status'] == 'needs_review' and not low:
                raise ValueError('summary_review: result_status_mismatch')
            return rpc.execute()
        return SimpleNamespace(execute=execute)

def db():
    d = ContractDB(DATA['summary'], DATA['transcript'])
    d.tables['summary_review_runs'][0]['stream_id'] = RULE['stream_id']
    d.tables['transcript_snapshots'][0].update(id=RULE['snapshot_id'], stream_id=RULE['stream_id'], snippets=copy.deepcopy(DATA['snippets']))
    return d

def consume(d, extractor=None, stream=None, snapshot=None):
    return review.consume_review_run(d, 'r', stream or RULE['stream_id'], snapshot_id=snapshot or RULE['snapshot_id'], candidate_extractor=extractor)

def test_pending_copy_and_locked(monkeypatch):
    http = HTTP(RULE['official_quote']); monkeypatch.setattr(sources.httpx, 'Client', http)
    d = db(); assert DATA['original_is_reviewed'] is True
    assert review.consume_first_saved(d, {'was_first_summary_success': True, 'is_review_locked': True, 'review_run_id': 'r', 'stream_id': RULE['stream_id']}) is None
    assert not d.calls and not http.calls
    assert consume(d, lambda *a: (_ for _ in ()).throw(AssertionError('LLM called')))['state'] == 'succeeded'
    assert [x[0] for x in d.calls] == ['claim_summary_review_run', 'commit_summary_review_run']
    payload = d.calls[-1][1]
    assert payload['p_new_status'] == 'auto_fixed'
    assert payload['p_summary_text'] == DATA['summary'].replace('あい子', 'aiko', 1)
    assert DATA['summary'].count('あい子') == 1
    evidence = json.loads(payload['p_findings'][0]['evidence'])
    assert evidence['official']['quote'] == RULE['official_quote'] and len(evidence['official']['sha256']) == 64
    assert evidence['official']['retrieved_at'] and evidence['official']['end'] - evidence['official']['start'] == len(RULE['official_quote'])
    assert http.calls == [('GET', RULE['url'])]

@pytest.mark.parametrize('variant', ['stream', 'snapshot', 'summary', 'transcript', 'snippet'])
def test_mismatch_never_fixes(monkeypatch, variant):
    http = HTTP(RULE['official_quote']); monkeypatch.setattr(sources.httpx, 'Client', http)
    d = db(); r = d.tables['summary_review_runs'][0]; stream = RULE['stream_id']; snap = RULE['snapshot_id']
    if variant == 'stream':
        stream = 'other'; r['stream_id'] = stream; d.tables['transcript_snapshots'][0]['stream_id'] = stream
    if variant == 'snapshot': snap = 'other'; d.tables['transcript_snapshots'][0]['id'] = snap
    if variant == 'summary': r['input_summary'] += '変更'
    if variant == 'transcript': r['input_transcript'] += '変更'
    if variant == 'snippet': d.tables['transcript_snapshots'][0]['snippets'][78]['start'] += 1
    original = r['input_summary']
    consume(d, lambda *a: {'candidates': []}, stream, snap)
    assert d.calls[-1][1]['p_summary_text'] == original and d.calls[-1][1]['p_new_status'] != 'auto_fixed'
    assert not http.calls

@pytest.mark.parametrize('text', [None, '別番組にaikoが出演', '10月21日25時より放送のニッポン放送『サカナクション山口一郎のオールナイトニッポン』にaikoがゲスト生出演する。', '10月20日25時より放送のニッポン放送『サカナクション山口一郎のオールナイトニッポン』に別人がゲスト生出演する。', '引用不一致'])
def test_official_failure(monkeypatch, text):
    http = HTTP(text); monkeypatch.setattr(sources.httpx, 'Client', http)
    d = db(); result = consume(d, lambda *a: (_ for _ in ()).throw(AssertionError()))
    payload = d.calls[-1][1]; run = d.tables['summary_review_runs'][0]
    assert result['state'] == 'succeeded' and run['state'] == 'succeeded'
    assert payload['p_summary_text'] == DATA['summary'] and payload['p_new_status'] == 'needs_review'
    assert run['result_payload']['summary'] == DATA['summary'] and run['result_payload']['status'] == 'needs_review'
    assert len(payload['p_findings']) == 1
    finding = payload['p_findings'][0]
    assert finding['confidence'] == 'low' and finding['before_text'] == finding['after_text'] == RULE['before']
    assert finding['evidence'].strip()

def test_contract_rejects_invalid_needs_review():
    d = db()
    with pytest.raises(ValueError, match='result_status_mismatch'):
        d.rpc('commit_summary_review_run', {'p_findings': [], 'p_new_status': 'needs_review'}).execute()
    with pytest.raises(ValueError, match='low_change'):
        d.rpc('commit_summary_review_run', {'p_findings': [{'confidence': 'low', 'before_text': 'a', 'after_text': 'b'}], 'p_new_status': 'needs_review'}).execute()

@pytest.mark.parametrize('duplicate', [False, True])
def test_forged_rule_and_duplicate(monkeypatch, duplicate):
    http = HTTP(''); monkeypatch.setattr(sources.httpx, 'Client', http)
    d = db(); r = d.tables['summary_review_runs'][0]; r['input_summary'] += '変更'
    c = {'before':'あい子','after':'aiko','snippet_index':78,'quote':DATA['snippets'][78]['text'],'rule_id': RULE['id'] if duplicate else 'fake'}
    consume(d, lambda *a: {'candidates': [c, c] if duplicate else [c]})
    assert d.calls[-1][1]['p_summary_text'] == r['input_summary'] and d.calls[-1][1]['p_new_status'] == 'needs_review'
