import json
from http.client import IncompleteRead
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from pubmed_screening.client import PubMedClient, ReplayTransport

FIXTURE = Path(__file__).parent / 'fixtures' / 'inhaler'


class ClientTests(unittest.TestCase):
    def replay(self):
        manifest = json.loads((FIXTURE / 'manifest.json').read_text())
        return manifest, ReplayTransport(FIXTURE)

    def test_recorded_search_preserves_translation_and_full_abstracts(self):
        manifest, replay = self.replay()
        result = PubMedClient(transport=replay, interval=0).search(manifest['query'], max_records=6)
        self.assertGreater(result['matched'], 6)
        self.assertEqual(len(result['records']), 6)
        self.assertTrue(result['truncated'])
        self.assertTrue(any(r['abstract'] for r in result['records']))
        self.assertTrue(result['translation'])
        self.assertEqual(len(result['responses']), 2)

    def test_replay_rejects_wrong_query(self):
        with self.assertRaisesRegex(ValueError, 'recorded request'):
            PubMedClient(transport=ReplayTransport(FIXTURE), interval=0).search('wrong', 6)

    def test_zero_results_skips_fetch(self):
        def transport(endpoint, params):
            self.assertEqual(endpoint, 'esearch.fcgi')
            return b'{"esearchresult":{"count":"0","idlist":[],"querytranslation":"nothing"}}'
        result = PubMedClient(transport=transport, interval=0).search('nothing')
        self.assertEqual(result['records'], [])
        self.assertFalse(result['truncated'])

    def test_invalid_caps(self):
        for cap in [0, -1, 10000]:
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                PubMedClient(interval=0).search('anything', cap)

    def test_api_errors_and_missing_ids_fail(self):
        for data in [dict(error='bad query'), dict(esearchresult=dict(count='1', idlist=[], querytranslation='x')),
                     dict(esearchresult=dict(count='0', idlist=[], errorlist={'phrasesnotfound': ['bad term']}))]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                PubMedClient(transport=lambda *_: json.dumps(data).encode(), interval=0).search('x')

    def test_missing_fetched_records_fail_instead_of_inflating_counts(self):
        def transport(endpoint, params):
            if endpoint == 'esearch.fcgi':
                return b'{"esearchresult":{"count":"1","idlist":["1"]}}'
            return b'<PubmedArticleSet />'
        with self.assertRaisesRegex(ValueError, 'PMID'):
            PubMedClient(transport=transport, interval=0).search('x')

    def test_fetch_batches_and_verifies_each_requested_id(self):
        calls = []
        def transport(endpoint, params):
            calls.append((endpoint, params))
            if endpoint == 'esearch.fcgi':
                return b'{"esearchresult":{"count":"3","idlist":["1","2","3"]}}'
            return ('<PubmedArticleSet>' + ''.join('<PubmedArticle><MedlineCitation><PMID>' + p + '</PMID><Article><ArticleTitle>T</ArticleTitle></Article></MedlineCitation></PubmedArticle>' for p in params['id'].split(',')) + '</PubmedArticleSet>').encode()
        result = PubMedClient(transport=transport, interval=0, batch_size=2).search('x', 3)
        self.assertEqual([r['pmid'] for r in result['records']], ['1', '2', '3'])
        self.assertEqual([p['id'] for e, p in calls if e == 'efetch.fcgi'], ['1,2', '3'])

    def test_transient_errors_retry_but_permanent_errors_do_not(self):
        for code, expected_calls in [(429, 3), (503, 3), (400, 1)]:
            calls = []
            def transport(*_):
                calls.append(1)
                raise HTTPError('https://example.invalid', code, 'failed', {}, None)
            with self.subTest(code=code), patch('pubmed_screening.client.time.sleep'), self.assertRaises(ValueError):
                PubMedClient(transport=transport, interval=0).search('x')
            self.assertEqual(len(calls), expected_calls)

    def test_interrupted_response_retries_and_returns_a_readable_error(self):
        attempts = []
        def interrupted(*_):
            attempts.append(1)
            raise IncompleteRead(b'partial', 100)
        with patch('pubmed_screening.client.time.sleep'), self.assertRaisesRegex(ValueError, '3 attempts'):
            PubMedClient(transport=interrupted, interval=0).search('x')
        self.assertEqual(len(attempts), 3)

    def test_interrupted_response_can_recover(self):
        attempts = []
        def recover(*_):
            attempts.append(1)
            if len(attempts) == 1:
                raise IncompleteRead(b'partial', 100)
            return b'{"esearchresult":{"count":"0","idlist":[]}}'
        with patch('pubmed_screening.client.time.sleep'):
            result = PubMedClient(transport=recover, interval=0).search('x')
        self.assertEqual(result['records'], [])
        self.assertEqual(len(attempts), 2)

    def test_request_spacing_is_enforced(self):
        times = iter([0.0, 0.1, 0.36])
        def transport(endpoint, params):
            if endpoint == 'esearch.fcgi':
                return b'{"esearchresult":{"count":"1","idlist":["1"]}}'
            return b'<PubmedArticleSet />'
        with patch('pubmed_screening.client.time.monotonic', side_effect=lambda: next(times)), patch('pubmed_screening.client.time.sleep') as sleep:
            with self.assertRaises(ValueError):
                PubMedClient(transport=transport).search('x')
            self.assertAlmostEqual(sleep.call_args.args[0], .26)


if __name__ == '__main__':
    unittest.main()
