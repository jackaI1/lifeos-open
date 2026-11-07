"""Pure query, PubMed XML, deduplication, and screening-count operations."""

import re
import xml.etree.ElementTree as ET
from collections import Counter


def build_query(mesh, boolean=''):
    """OR related MeSH headings, then AND the grouped raw Boolean expression."""
    headings = []
    for term in mesh:
        term = term.strip()
        if not term or any(c in term for c in '"[]\n\r'):
            raise ValueError('MeSH headings must be nonempty plain terms without quotes or tags')
        headings.append(f'"{term}"[MeSH Terms]')
    parts = ['(' + ' OR '.join(headings) + ')'] if headings else []
    if boolean.strip():
        parts.append('(' + boolean.strip() + ')')
    if not parts:
        raise ValueError('Supply a Boolean query or a MeSH heading')
    return ' AND '.join(parts)


def normalize_doi(doi):
    return re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)', '', doi.strip(), flags=re.I).lower()


def _text(node):
    return ''.join(node.itertext()).strip() if node is not None else ''


def parse_articles(xml):
    root = ET.fromstring(xml)
    errors = root.findall('.//ERROR') + root.findall('.//Error')
    if errors:
        raise ValueError('NCBI EFetch error: ' + '; '.join(_text(e) for e in errors))
    if root.tag != 'PubmedArticleSet':
        raise ValueError('Expected a PubmedArticleSet XML response')
    records = []
    for article in root.findall('PubmedArticle'):
        pmid = article.findtext('MedlineCitation/PMID', '').strip()
        if not pmid.isdigit():
            raise ValueError('Article is missing a valid PMID')
        data = article.find('MedlineCitation/Article')
        if data is None:
            raise ValueError('Article metadata missing for PMID ' + pmid)
        abstract = []
        for section in data.findall('Abstract/AbstractText'):
            text = _text(section)
            label = section.get('Label', '')
            abstract.append((label + ': ' if label else '') + text)
        doi = next((_text(n) for n in article.findall('PubmedData/ArticleIdList/ArticleId')
                    if n.get('IdType') == 'doi'), '')
        if not doi:
            doi = next((_text(n) for n in data.findall('ELocationID') if n.get('EIdType') == 'doi'), '')
        date = data.find('Journal/JournalIssue/PubDate')
        year = re.search(r'\b\d{4}\b', (date.findtext('Year') or date.findtext('MedlineDate') or '') if date is not None else '')
        records.append(dict(pmid=pmid, doi=normalize_doi(doi), title=_text(data.find('ArticleTitle')),
                            abstract='\n'.join(abstract), journal=_text(data.find('Journal/Title')),
                            year=year.group() if year else ''))
    return records


def deduplicate(records):
    """Connected components of PMID/DOI matches, retaining first-seen canonical PMID."""
    parents = list(range(len(records)))

    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    seen = {}
    for i, record in enumerate(records):
        keys = [('pmid', record['pmid'])]
        doi = normalize_doi(record['doi'])
        if doi:
            keys.append(('doi', doi))
        for key in keys:
            if key in seen:
                a, b = find(i), find(seen[key])
                parents[max(a, b)] = min(a, b)
            seen[key] = i
    groups = {}
    for i, record in enumerate(records):
        root = find(i)
        if root not in groups:
            groups[root] = dict(record=dict(record), pmids=[], occurrences=0)
        group = groups[root]
        group['occurrences'] += 1
        if record['pmid'] not in group['pmids']:
            group['pmids'].append(record['pmid'])
        for key, value in record.items():
            if not group['record'].get(key) and value:
                group['record'][key] = value
        group['record']['doi'] = normalize_doi(group['record']['doi'])
    return list(groups.values())


def group_decision(group, decisions):
    values = {decisions[p] for p in group['pmids'] if p in decisions}
    if len(values) > 1:
        raise ValueError('Screening decision conflict for PMIDs ' + ', '.join(group['pmids']) +
                         '; rescreen the canonical PMID to resolve the group')
    return next(iter(values), ('pending', ''))


def flow_counts(groups, decisions):
    statuses = Counter()
    reasons = Counter()
    for group in groups:
        status, reason = group_decision(group, decisions)
        statuses[status] += 1
        if status == 'exclude':
            reasons[reason] += 1
    downloaded = sum(g['occurrences'] for g in groups)
    return dict(records_downloaded=downloaded, duplicates_removed=downloaded - len(groups),
                records_to_screen=len(groups), records_screened=statuses['include'] + statuses['exclude'],
                pending=statuses['pending'], excluded=statuses['exclude'],
                included_title_abstract=statuses['include'], exclusion_reasons=dict(sorted(reasons.items())))
