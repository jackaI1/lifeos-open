"""Bounded E-utilities downloads and exact, checksummed offline replay."""

import hashlib
import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .core import parse_articles

BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'


class ReplayTransport:
    """Replay recorded public responses only when endpoint and parameters match."""

    def __init__(self, directory):
        self.directory = Path(directory)
        self.manifest = json.loads((self.directory / 'manifest.json').read_text())
        self.position = 0

    def __call__(self, endpoint, params):
        calls = self.manifest['calls']
        if self.position >= len(calls):
            raise ValueError('No recorded request remains')
        call = calls[self.position]
        if endpoint != call['endpoint'] or params != call['params']:
            raise ValueError('Request does not match the recorded request')
        path = (self.directory / call['file']).resolve()
        if path.parent != self.directory.resolve():
            raise ValueError('Fixture path must stay inside its directory')
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != call['sha256']:
            raise ValueError('Recorded response checksum mismatch')
        self.position += 1
        return body


class PubMedClient:
    def __init__(self, transport=None, interval=.36, batch_size=100):
        self.transport = transport or self._live
        self.interval = interval
        if not 1 <= batch_size <= 200:
            raise ValueError('Batch size must be between 1 and 200')
        self.batch_size = batch_size
        self.last_request = None

    @staticmethod
    def _live(endpoint, params):
        # Credentials/contact are sent only over HTTPS; never enter saved run metadata.
        params = dict(params)
        for env, name in [('NCBI_EMAIL', 'email'), ('NCBI_API_KEY', 'api_key')]:
            if os.environ.get(env):
                params[name] = os.environ[env]
        data = urllib.parse.urlencode(params).encode()
        request = urllib.request.Request(BASE_URL + endpoint, data=data,
                                         headers={'User-Agent': 'pubmed-screening-tool/0.1'})
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.read()

    def _request(self, endpoint, params):
        for attempt in range(3):
            if self.last_request is not None:
                delay = self.interval - (time.monotonic() - self.last_request)
                if delay > 0:
                    time.sleep(delay)
            self.last_request = time.monotonic()
            try:
                return self.transport(endpoint, params)
            except urllib.error.HTTPError as exc:
                if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise ValueError(f'NCBI HTTP {exc.code}; no search was saved') from None
                try:
                    delay = float(exc.headers.get('Retry-After', 2 ** attempt))
                except (ValueError, TypeError):
                    delay = 2 ** attempt
                time.sleep(min(max(delay, 0), 30))
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
                if attempt == 2:
                    raise ValueError('NCBI network request failed after 3 attempts; no search was saved') from None
                time.sleep(2 ** attempt)

    def search(self, query, max_records=200):
        if not 1 <= max_records <= 9999:
            raise ValueError('max_records must be 1..9999; split larger searches into explicit date ranges')
        if not query.strip():
            raise ValueError('Query must not be empty')
        started_at = datetime.now(timezone.utc).isoformat()
        params = dict(db='pubmed', term=query, retmax=str(max_records), retmode='json',
                      sort='relevance', tool='pubmed-screening-tool')
        body = self._request('esearch.fcgi', params)
        raw = json.loads(body)
        data = raw.get('esearchresult', {})
        if raw.get('error') or data.get('error') or data.get('errorlist'):
            raise ValueError('NCBI rejected search terms; inspect the query and MeSH headings')
        try:
            matched = int(data['count'])
            ids = data['idlist']
            if matched < 0 or len(ids) != min(matched, max_records) or len(set(ids)) != len(ids):
                raise ValueError('NCBI returned an incomplete or duplicate PMID list')
            if any(not isinstance(p, str) or not p.isdigit() for p in ids):
                raise ValueError('NCBI returned invalid PMIDs')
        except (KeyError, TypeError) as exc:
            raise ValueError('Invalid NCBI search response') from exc
        responses = [dict(endpoint='esearch.fcgi', params=params, body=body.decode('utf-8'))]
        records = []
        for start in range(0, len(ids), self.batch_size):
            batch = ids[start:start + self.batch_size]
            params = dict(db='pubmed', id=','.join(batch), retmode='xml', rettype='abstract', tool='pubmed-screening-tool')
            body = self._request('efetch.fcgi', params)
            rows = parse_articles(body)
            if sorted(r['pmid'] for r in rows) != sorted(batch):
                raise ValueError('NCBI EFetch PMID mismatch; no partial search was saved')
            records.extend(rows)
            responses.append(dict(endpoint='efetch.fcgi', params=params, body=body.decode('utf-8')))
        return dict(query=query, searched_at=started_at, matched=matched, max_records=max_records,
                    translation=data.get('querytranslation', ''), warnings=data.get('warninglist', {}),
                    truncated=matched > len(records), records=records, responses=responses,
                    source='recorded' if isinstance(self.transport, ReplayTransport) else 'live',
                    captured_at=self.transport.manifest['captured_at'] if isinstance(self.transport, ReplayTransport) else started_at)
