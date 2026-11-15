import json
import summary_review as review
from test_summary_review import DB


def test_natural_alignment_requires_verified_rule_and_exact_snapshot(monkeypatch):
    text = '出演は山口一郎です'
    db = DB(summary='出演は山口一朗です', transcript=text)
    c = {'before': '山口一朗', 'after': '山口一郎', 'snippet_index': 0, 'quote': text,
         'summary_start': 3, 'summary_end': 7, 'subtitle_start': 3, 'subtitle_end': 7,
         'left_anchor': '出演は', 'right_anchor': 'です', 'rule_id': 'unverified'}
    class Source:
        status = 'ok'
        def find(self, name): return {'quote': name}
    summary, status, findings = review._validate(db, db.tables['summary_review_runs'][0], 's', 'snap', [c], Source())
    assert status == 'needs_review' and summary == '出演は山口一朗です'
    assert findings[0]['before_text'] == findings[0]['after_text']
    assert review._alignment(summary, text, c)
    assert not review._alignment(summary, text, dict(c, quote='other', subtitle_start=2))
    db.tables['transcript_snapshots'][0]['snippets'][0]['text'] += ' '
    called = []
    result = review.consume_review_run(db, 'r', 's', snapshot_id='snap', candidate_extractor=lambda *a: called.append(1))
    assert result['state'] == 'failed' and called == []


def test_claim_and_locked_do_not_call_external(monkeypatch):
    db = DB()
    db.tables['summary_review_runs'][0]['state'] = 'running'
    assert not review.consume_review_run(db, 'r', 's', candidate_extractor=lambda *a: 1)['claimed']
    assert not db.calls
    monkeypatch.setattr(review, 'consume_review_run', lambda *a, **kw: (_ for _ in ()).throw(AssertionError()))
    assert review.consume_first_saved(db, {'was_first_summary_success': True, 'is_review_locked': True, 'review_run_id': 'r', 'stream_id': 's'}) is None
