import httpx
import official_review_sources as source


def test_bounded_fetch_and_caching(monkeypatch):
    calls = []
    def handler(request):
        calls.append(str(request.url))
        assert request.method == 'GET' and not request.url.query
        return httpx.Response(200, text='<script>偽名</script><p>山口一郎</p>')
    transport = httpx.MockTransport(handler)
    original = httpx.Client
    monkeypatch.setattr(source.httpx, 'Client', lambda **kw: original(transport=transport, **kw))
    s = source.default_factory()
    evidence = s.find('山口一郎')
    assert evidence['quote'] == '山口一郎' and len(evidence['sha256']) == 64
    assert s.find('偽名') is None and calls == list(source.URLS) and s.status == 'ok'


def test_redirect_error_and_oversize(monkeypatch):
    original = httpx.Client
    for response in (httpx.Response(302, headers={'location': 'http://127.0.0.1/'}),
                     httpx.Response(200, content=b'x' * (source.MAX_BYTES + 1))):
        transport = httpx.MockTransport(lambda request: response)
        monkeypatch.setattr(source.httpx, 'Client', lambda **kw: original(transport=transport, **kw))
        s = source.default_factory()
        assert s.find('山口一郎') is None and s.status == 'unavailable'
