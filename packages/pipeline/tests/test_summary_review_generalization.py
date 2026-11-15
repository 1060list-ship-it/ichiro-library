import copy
import json
import socket
from pathlib import Path

import httpx
import pytest
import summary_review as review
import official_review_sources

CASES = json.loads((Path(__file__).parent / 'fixtures/summary_review_generalization/real.json').read_text())
QUOTE = json.loads((Path(review.__file__).parent / 'summary_review_cases.json').read_text())[0]['official_quote']

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def reject(*a, **k):
        raise AssertionError('network forbidden')
    monkeypatch.setattr(socket.socket, 'connect', reject)
    monkeypatch.setattr(official_review_sources, 'default_factory', lambda: Source())

class Result:
    def __init__(self, data): self.data = data
    def execute(self): return self

class Query:
    def __init__(self, db, table): self.db, self.name, self.filters = db, table, {}
    def select(self, *a): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def limit(self, n): return self
    def execute(self):
        return Result([x for x in self.db.tables.get(self.name, []) if all(x.get(k) == v for k, v in self.filters.items())][:1])

class DB:
    def __init__(self, c, pending=True):
        src = c['source']; sid = src.get('stream_id') or 'unavailable-' + c['case_id']
        snapshots = [dict(id=x['snapshot_id'], stream_id=sid, snippets=copy.deepcopy(x['snippets'])) for x in c['snapshots']]
        self.sid = sid; self.snapshot = src.get('snapshot_id'); self.calls = []; self.payloads = []
        self.tables = {'streams':[{'id':sid,'title':c['title'],'stream_date':c['date']}],
                       'transcript_snapshots': snapshots,
                       'summary_review_runs':[{'review_run_id':'run','stream_id':sid,'state':'pending' if pending else 'stale',
                                               'input_summary':c['summary'],'input_transcript':c['transcript']}]}
        self.lose = False
    def table(self, name): return Query(self, name)
    def rpc(self, name, p):
        self.calls.append(name); run = self.tables['summary_review_runs'][0]
        if name == 'claim_summary_review_run':
            run.update(state='running', attempt_id=p['p_attempt_id'])
            return Result({'claimed':True,'attempt_id':p['p_attempt_id']})
        self.payloads.append(copy.deepcopy(p))
        findings, summary, status = p['p_findings'], p['p_summary_text'], p['p_new_status']
        assert status != 'needs_review' or any(f['confidence'] == 'low' for f in findings)
        assert status not in ('reviewed_no_change', 'review_failed') or (not findings and summary == run['input_summary'])
        rebuilt = run['input_summary']
        for f in findings:
            assert all(isinstance(f.get(k), str) and f[k].strip() for k in ('finding_type', 'rule_id', 'field', 'before_text', 'after_text', 'confidence', 'evidence'))
            if f['confidence'] == 'low': assert f['before_text'] == f['after_text']
            else: rebuilt = rebuilt.replace(f['before_text'], f['after_text'])
        assert summary == rebuilt
        if status == 'auto_fixed': assert summary != run['input_summary'] and any(f['confidence'] == 'high' and f['before_text'] != f['after_text'] for f in findings) and all(f['confidence'] != 'low' for f in findings)
        if self.lose:
            self.lose = False
            raise httpx.ReadError('lost response')
        run.update(state='succeeded',result_payload={'summary':summary,'status':status,'findings':findings})
        return Result({'state':'succeeded','status':status})

class Source:
    status = 'ok'
    def find_case_quote(self, quote):
        assert quote == QUOTE
        return {'url':'https://news.ponycanyon.co.jp/2026/10/126960','quote':quote,'sha256':'stub','start':0,'end':len(quote),'retrieved_at':'stub'}

def consume(db):
    return review.consume_review_run(db,'run',db.sid,snapshot_id=db.snapshot,official_source=Source(),candidate_extractor=lambda run, model: {'candidates':[]})

def test_real_cases(capsys):
    for c in CASES:
        db=DB(c)
        if c['is_reviewed']:
            result=review.consume_first_saved(db,{'was_first_summary_success':True,'is_review_locked':True,'review_run_id':'run','stream_id':db.sid},snapshot_id=db.snapshot)
            assert result is None and not db.calls
            print(c['case_id'], 'locked')
        else:
            result=consume(db)
            assert result['status']=='needs_review' and db.payloads[0]['p_summary_text']==c['summary']
            print(c['case_id'], result['status'],json.loads(db.payloads[0]['p_findings'][0]['evidence'])['reason'])
    db=DB(CASES[2]); result=consume(db)
    assert result['status']=='auto_fixed'
    assert db.payloads[0]['p_summary_text']==CASES[2]['summary'].replace('あい子','aiko')
    print(CASES[2]['case_id'], 'hypothetical_pending auto_fixed')

def test_variants():
    for variant in ('base','surroundings','ids'):
        db=DB(CASES[2]); run=db.tables['summary_review_runs'][0]
        if variant=='surroundings': run['input_summary'] += '\n別の話題を追記。'
        if variant=='ids':
            db.sid='new-stream'; db.snapshot='new-snapshot'; run['stream_id']=db.sid
            db.tables['streams'][0]['id']=db.sid
            db.tables['transcript_snapshots'][0].update(id=db.snapshot,stream_id=db.sid)
        assert consume(db)['status']=='auto_fixed', variant

@pytest.mark.parametrize('variant',['date','person','denial','past','quoted','multiple','missing_meta','wrong_snapshot','missing_snapshot','transcript_mismatch','official_missing','competing'])
def test_low(variant):
    db=DB(CASES[2]); run=db.tables['summary_review_runs'][0]; stream=db.tables['streams'][0]
    if variant=='date': stream['stream_date']='2026-10-21'
    if variant=='person': stream['title']=stream['title'].replace('aiko','別人')
    if variant=='denial': run['input_summary']=run['input_summary'].replace('ゲスト出演する','ゲスト出演しない')
    if variant=='past': run['input_summary']=run['input_summary'].replace('この夜','前回')
    if variant=='quoted': run['input_summary']='「今夜のオールナイトニッポンにゲスト出演するあい子さん」'
    if variant=='multiple': run['input_summary']+='今夜のオールナイトニッポンにゲスト出演するあい子さん。'
    if variant=='competing':
        snap=db.tables['transcript_snapshots'][0]
        snap['snippets'].append({'text':'今日のオールナイト日本には別人さんが来てくれます。'})
        run['input_transcript']=' '.join(x['text'] for x in snap['snippets'])
    if variant=='missing_meta': stream['title']=None
    if variant=='wrong_snapshot': db.tables['transcript_snapshots'][0]['stream_id']='other'
    if variant=='missing_snapshot': db.snapshot=None
    if variant=='transcript_mismatch': run['input_transcript']+='変更'
    if variant=='official_missing':
        class Missing(Source):
            def find_case_quote(self, quote): return None
        result=review.consume_review_run(db,'run',db.sid,snapshot_id=db.snapshot,official_source=Missing(),candidate_extractor=lambda run, model: {'candidates':[]})
    else: result=consume(db)
    assert result['status']=='needs_review'
    assert db.payloads[0]['p_summary_text']==run['input_summary']

def test_retry_and_terminal():
    db=DB(CASES[2]); db.lose=True
    assert consume(db)['status']=='auto_fixed'
    assert len(db.payloads)==2 and db.payloads[0]==db.payloads[1]
    before=len(db.calls); assert consume(db)['claimed'] is False; assert len(db.calls)==before
    stale=DB(CASES[2],pending=False); assert consume(stale)['claimed'] is False and not stale.calls


def test_extractor_failure_is_distinct():
    db=DB(CASES[0])
    def broken(*args): raise RuntimeError('extractor failure')
    result=review.consume_review_run(db,'run',db.sid,snapshot_id=db.snapshot,official_source=Source(),candidate_extractor=broken)
    assert result['status']=='review_failed' and db.payloads[0]['p_findings']==[]


@pytest.mark.parametrize('summary', [
    '今夜のオールナイトニッポンにゲスト出演する別人の話を、あい子さんが聞いた。',
    '今夜のオールナイトニッポンにゲスト出演する「あい子さん」という噂は誤りだ。',
    '今夜のオールナイトニッポンにゲスト出演するのは、あい子さんではありません。',
    '今夜のオールナイトニッポンにゲスト出演するあい子さんだとすれば楽しみだ。',
    '今夜のオールナイトニッポン0にゲスト出演するあい子さんの話。',
    '今夜のオールナイトニッポンにゲスト出演するあい子供さんの話。',
    'もし今夜のオールナイトニッポンにゲスト出演するあい子さんの話。',
])
def test_adversarial_summary(summary):
    db = DB(CASES[2]); db.tables['summary_review_runs'][0]['input_summary'] = summary
    result = consume(db)
    assert result['status'] == 'needs_review'
    assert db.payloads[0]['p_summary_text'] == summary
    assert any(f['confidence'] == 'low' for f in db.payloads[0]['p_findings'])

@pytest.mark.parametrize('field,old,new', [
    ('title', 'オールナイトニッポン', 'オールナイトニッポン0'),
    ('title', 'aikoさんがゲストで来てくださります', 'aikoさんがゲストで来てくださりますという噂は誤りだ'),
    ('subtitle', 'オールナイト日本にはあ子さんが来てくれます', 'オールナイト日本0にはあ子さんが来てくれます'),
    ('subtitle', 'オールナイト日本にはあ子さんが来てくれます', 'オールナイト日本にはあ子供さんが来てくれます'),
    ('subtitle', 'あ子さんが来てくれます。', 'あ子さんが来てくれますという噂は誤りです。'),
])
def test_other_local_roles_rejected(field, old, new):
    db = DB(CASES[2]); run = db.tables['summary_review_runs'][0]
    if field == 'title':
        stream = db.tables['streams'][0]
        assert old in stream['title']; stream['title'] = stream['title'].replace(old, new)
    else:
        snippets = db.tables['transcript_snapshots'][0]['snippets']
        assert any(old in x['text'] for x in snippets)
        for x in snippets: x['text'] = x['text'].replace(old, new)
        run['input_transcript'] = ' '.join(x['text'] for x in snippets)
    assert consume(db)['status'] == 'needs_review'
    assert db.payloads[0]['p_summary_text'] == run['input_summary']


def date_case_db(video_id='kzo6M_omHTM'):
    backup = Path(__file__).parents[3] / 'docs/operations/summary-date-fix-20260929-backup.json'
    original = json.loads(backup.read_text(encoding='utf-8'))[video_id]
    c = {'case_id': original['video_id'], 'source': {'stream_id': 'date-copy', 'snapshot_id': None},
         'snapshots': [], 'title': original['title'], 'date': original['stream_date'],
         'summary': original['summary'], 'transcript': None}
    db = DB(c)
    db.tables['streams'][0]['video_id'] = original['video_id']
    return db, original


def test_date_case_real_archival_copy_and_locked():
    db, original = date_case_db()
    assert review.consume_first_saved(db, {'was_first_summary_success': True, 'is_review_locked': True,
        'review_run_id': 'run', 'stream_id': db.sid}) is None
    assert db.calls == []
    result = consume(db)
    payload = db.payloads[-1]
    assert result['status'] == 'auto_fixed'
    assert payload['p_summary_text'] == original['summary'].replace('2024年8月15日', '2025年8月15日', 1)
    assert len(payload['p_findings']) == 1
    finding = payload['p_findings'][0]
    assert finding['before_text'] == '2024年8月15日' and finding['after_text'] == '2025年8月15日'
    assert json.loads(finding['evidence'])['transcript_snapshot_verified'] is False


def test_date_case_second_archival_copy():
    db, original = date_case_db('DFIBxdrfVH8')
    assert review.consume_first_saved(db, {'was_first_summary_success': True, 'is_review_locked': True,
        'review_run_id': 'run', 'stream_id': db.sid}) is None
    assert db.calls == []
    assert consume(db)['status'] == 'auto_fixed'
    payload = db.payloads[-1]
    assert payload['p_summary_text'] == original['summary'].replace('2024年5月5日', '2026年5月5日', 1)
    evidence = json.loads(payload['p_findings'][0]['evidence'])
    assert evidence['video_id'] == 'DFIBxdrfVH8' and evidence['transcript_snapshot_verified'] is False


@pytest.mark.parametrize('variant', ['video', 'title', 'date', 'prefix', 'duplicate', 'snapshot_mismatch'])
def test_date_case_second_mismatch(variant):
    db, _ = date_case_db('DFIBxdrfVH8')
    stream = db.tables['streams'][0]
    run = db.tables['summary_review_runs'][0]
    if variant == 'video': stream['video_id'] = 'other'
    if variant == 'title': stream['title'] += '変更'
    if variant == 'date': stream['stream_date'] = '2026-05-06'
    if variant == 'prefix': run['input_summary'] = '過去の話。' + run['input_summary']
    if variant == 'duplicate': run['input_summary'] += '2024年5月5日の話。'
    if variant == 'snapshot_mismatch':
        db.snapshot = 'wrong-snapshot'
        db.tables['transcript_snapshots'] = [{'id': db.snapshot, 'stream_id': 'other', 'snippets': [{'text': '字幕'}]}]
    original = run['input_summary']
    assert consume(db)['status'] == 'needs_review'
    assert db.payloads[-1]['p_summary_text'] == original


@pytest.mark.parametrize('variant', ['video', 'title', 'date', 'prefix', 'duplicate', 'already_fixed'])
def test_date_case_mismatch_never_changes_body(variant):
    db, _ = date_case_db()
    stream = db.tables['streams'][0]
    run = db.tables['summary_review_runs'][0]
    if variant == 'video': stream['video_id'] = 'other'
    if variant == 'title': stream['title'] += '変更'
    if variant == 'date': stream['stream_date'] = '2025-08-16'
    if variant == 'prefix': run['input_summary'] = '過去の話。' + run['input_summary']
    if variant == 'duplicate': run['input_summary'] += '2024年8月15日の話。'
    if variant == 'already_fixed': run['input_summary'] = run['input_summary'].replace('2024年8月15日', '2025年8月15日', 1)
    original = run['input_summary']
    assert consume(db)['status'] == 'needs_review'
    assert db.payloads[-1]['p_summary_text'] == original


@pytest.mark.parametrize('variant', ['matching', 'wrong_stream', 'wrong_transcript', 'not_found'])
def test_date_case_supplied_snapshot(variant):
    db, original = date_case_db()
    db.snapshot = 'provided-snapshot'
    db.tables['summary_review_runs'][0]['input_transcript'] = '実際の字幕'
    snapshot = {'id': db.snapshot, 'stream_id': db.sid, 'snippets': [{'text': '実際の字幕'}]}
    if variant == 'wrong_stream':
        snapshot['stream_id'] = 'other-stream'
    elif variant == 'wrong_transcript':
        snapshot['snippets'][0]['text'] = '異なる字幕'
    elif variant == 'not_found':
        snapshot['id'] = 'other-snapshot'
    db.tables['transcript_snapshots'] = [snapshot]
    result = consume(db)
    payload = db.payloads[-1]
    if variant == 'matching':
        assert result['status'] == 'auto_fixed'
        assert payload['p_summary_text'] == original['summary'].replace('2024年8月15日', '2025年8月15日', 1)
    else:
        assert result['status'] == 'needs_review'
        assert payload['p_summary_text'] == original['summary']
        assert payload['p_findings'][0]['confidence'] == 'low'
