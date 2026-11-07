import unittest
from pubmed_screening.core import build_query, deduplicate, flow_counts, parse_articles


def record(pmid, doi='', title='Title', abstract='Abstract'):
    return dict(pmid=pmid, doi=doi, title=title, abstract=abstract, year='2024', journal='Journal')


class QueryTests(unittest.TestCase):
    def test_mesh_and_boolean_are_parenthesized(self):
        self.assertEqual(build_query(['Inhalers'], 'usability[tiab] OR "use error"[tiab]'),
                         '("Inhalers"[MeSH Terms]) AND (usability[tiab] OR "use error"[tiab])')

    def test_mesh_only_and_raw_query(self):
        self.assertEqual(build_query(['Inhalers', 'Human Engineering'], ''),
                         '("Inhalers"[MeSH Terms] OR "Human Engineering"[MeSH Terms])')
        self.assertEqual(build_query([], 'asthma NOT animals[mh]'), '(asthma NOT animals[mh])')

    def test_blank_or_injected_mesh_is_rejected(self):
        for mesh, boolean in [([], ''), ([''], ''), (['x" OR y'], '')]:
            with self.subTest(mesh=mesh), self.assertRaises(ValueError):
                build_query(mesh, boolean)


class DedupeTests(unittest.TestCase):
    def test_normalized_doi_and_transitive_pmid_bridge(self):
        rows = [record('1'), record('2', 'https://doi.org/10.1234/ABC'),
                record('1', 'doi:10.1234/abc', abstract=''), record('3'), record('4')]
        groups = deduplicate(rows)
        self.assertEqual(len(groups), 3)
        self.assertEqual(groups[0]['pmids'], ['1', '2'])
        self.assertEqual(groups[0]['record']['abstract'], 'Abstract')
        self.assertEqual(groups[0]['occurrences'], 3)
        self.assertEqual(groups[0]['record']['doi'], '10.1234/abc')

    def test_missing_dois_do_not_collapse_unrelated_records(self):
        self.assertEqual(len(deduplicate([record('1'), record('2')])), 2)
        self.assertEqual(deduplicate([]), [])


class AbstractTests(unittest.TestCase):
    def test_structured_abstract_and_inline_markup(self):
        xml = b'''<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>7</PMID><Article>
        <Journal><Title>A journal</Title><JournalIssue><PubDate><MedlineDate>2022 Winter</MedlineDate></PubDate></JournalIssue></Journal>
        <ArticleTitle>A <i>device</i> study</ArticleTitle><Abstract><AbstractText Label="AIM">Find <b>errors</b>.</AbstractText>
        <AbstractText Label="RESULTS">Fewer errors.</AbstractText></Abstract></Article></MedlineCitation>
        <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/ABC</ArticleId></ArticleIdList></PubmedData>
        </PubmedArticle></PubmedArticleSet>'''
        rows = parse_articles(xml)
        self.assertEqual(rows[0], record('7', '10.1/abc', 'A device study', 'AIM: Find errors.\nRESULTS: Fewer errors.') | {'journal': 'A journal', 'year': '2022'})

    def test_year_is_not_concatenated_with_month(self):
        rows = parse_articles(b'<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>8</PMID><Article><Journal><Title>J</Title><JournalIssue><PubDate><Year>2024</Year><Month>Nov</Month><Day>6</Day></PubDate></JournalIssue></Journal><ArticleTitle>T</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>')
        self.assertEqual(rows[0]['year'], '2024')

    def test_missing_abstract_and_api_error(self):
        rows = parse_articles(b'<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>8</PMID><Article><ArticleTitle>Only title</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>')
        self.assertEqual(rows[0]['abstract'], '')
        with self.assertRaises(ValueError):
            parse_articles(b'<eFetchResult><ERROR>bad id</ERROR></eFetchResult>')


class FlowTests(unittest.TestCase):
    def test_pending_and_exclusion_reasons_balance(self):
        groups = deduplicate([record('1'), record('1'), record('2'), record('3'), record('4')])
        counts = flow_counts(groups, {'1': ('include', 'device use'), '2': ('exclude', 'wrong device'), '3': ('exclude', 'wrong device')})
        self.assertEqual(counts, {'records_downloaded': 5, 'duplicates_removed': 1,
                                'records_to_screen': 4, 'records_screened': 3, 'pending': 1,
                                'excluded': 2, 'included_title_abstract': 1, 'exclusion_reasons': {'wrong device': 2}})

    def test_conflicting_decisions_on_doi_duplicates_are_not_hidden(self):
        groups = deduplicate([record('1', '10.1/a'), record('2', '10.1/a')])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            flow_counts(groups, {'1': ('include', 'yes'), '2': ('exclude', 'no')})


if __name__ == '__main__':
    unittest.main()
