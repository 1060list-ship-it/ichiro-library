"""Bounded, anonymous retrieval of the two reviewed official pages (evidence A only)."""
import hashlib
from datetime import datetime, timezone
from html.parser import HTMLParser

import httpx

CASE_URL = 'https://news.ponycanyon.co.jp/2026/10/126960'
URLS = ('https://sakanaction.jp/feature/profile', 'https://sakanaction.jp/discography')
MAX_BYTES = 1_000_000
# Names individually confirmed in SOURCE_NOTES; page navigation is not a name field.
CONFIRMED_NAMES = {
    URLS[0]: frozenset(('山口一郎', '岩寺基晴', '草刈 愛美', '岡崎 英美', '江島啓一')),
    URLS[1]: frozenset(('怪獣／いらない', 'いらない', 'Garden Studies', '怪獣')),
}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.nodes = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'template', 'svg'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'template', 'svg') and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.nodes.append(' '.join(data.split()))


class OfficialSources:
    def __init__(self):
        self.documents = None
        self.status = 'not_fetched'

    def fetch(self):
        if self.documents is not None:
            return self.documents
        self.documents = []
        errors = []
        for url in URLS:
            try:
                with httpx.Client(timeout=5.0, follow_redirects=False, verify=True, trust_env=False) as client:
                    with client.stream('GET', url, headers={'Accept': 'text/html'}) as response:
                        if response.status_code != 200:
                            raise ValueError('HTTP status')
                        body = bytearray()
                        for chunk in response.iter_bytes():
                            if len(chunk) > MAX_BYTES - len(body):
                                raise ValueError('response too large')
                            body.extend(chunk)
                parser = _Text()
                parser.feed(body.decode('utf-8', errors='strict'))
                text = '\n'.join(parser.nodes)
                self.documents.append({'url': url, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'normalization': 'html-text-nodes-whitespace-v1', 'text': text,
                    'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'nodes': parser.nodes})
            except (httpx.HTTPError, ValueError, UnicodeError):
                errors.append(url)
        self.status = 'partial' if errors and self.documents else ('unavailable' if errors else 'ok')
        return self.documents

    def find_case_quote(self, quote):
        # Only this fixed URL is requested, and only after the full case matches.
        try:
            with httpx.Client(timeout=5.0, follow_redirects=False, verify=True, trust_env=False) as client:
                with client.stream('GET', CASE_URL, headers={'Accept': 'text/html'}) as response:
                    if response.status_code != 200:
                        raise ValueError('HTTP status')
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        if len(chunk) > MAX_BYTES - len(body):
                            raise ValueError('response too large')
                        body.extend(chunk)
            parser = _Text()
            parser.feed(body.decode('utf-8', errors='strict'))
            text = '\n'.join(parser.nodes)
            if text.count(quote) != 1:
                self.status = 'unavailable'
                return None
            start = text.index(quote)
            self.status = 'ok'
            return {'url': CASE_URL, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'normalization': 'html-text-nodes-whitespace-v1',
                    'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
                    'start': start, 'end': start + len(quote), 'quote': quote}
        except (httpx.HTTPError, ValueError, UnicodeError):
            self.status = 'unavailable'
            return None

    def find(self, name):
        for doc in self.fetch():
            # A complete text node, never a substring of unrelated content.
            if name in CONFIRMED_NAMES[doc['url']] and name in doc['nodes']:
                start = doc['text'].find(name)
                return {k: doc[k] for k in ('url', 'retrieved_at', 'normalization', 'sha256')} | {
                    'start': start, 'end': start + len(name), 'quote': name}
        return None


def default_factory():
    return OfficialSources()
