# Search and screening design

I keep the search engine separate from screening so a network failure cannot change a human decision.

## Parts

`core.py` builds grouped MeSH/Boolean expressions, parses PubMed XML, joins duplicate records, and calculates screening counts. It has no file or network side effects.

`client.py` requests ESearch JSON, captures the interpreted query and warnings, then fetches the returned PMID snapshot in XML batches of up to 100. It verifies that every requested PMID was received exactly once. A search is capped at 9,999 IDs; it never presents capped retrieval as exhaustive. Missing abstracts are represented by an empty string. Unexpected record formats fail the search rather than silently dropping records.

The HTTPS transport reads optional contact and API-key environment variables only when sending the request. They are never added to archived parameters. Each client spaces request attempts by at least 0.36 seconds, including retries, and waits up to 45 seconds for a request. HTTP 429 and transient server/network errors get at most three attempts. Retry delays are bounded at 30 seconds. Separate CLI processes do not share a rate limiter; I run live searches one at a time.

`workspace.py` uses SQLite transactions to archive complete search results as JSON and append screening events. Raw ESearch/EFetch bodies and their public parameters are retained with every run. Run IDs are local database identifiers, not PubMed IDs. Replay logs keep both the original response capture time and the new replay time, and label their source as recorded. Screening events store UTC time, PMID, decision and reason. I can inspect the history or raw search detail through the CLI.

Reports and screening exports use an explicit database read transaction, so concurrent screening cannot make a flow count disagree with its included CSV.

An import validates every row before appending any events. It rejects unknown identifiers, missing reasons, invalid decisions and two rows for the same duplicate group. Repeating an unchanged decision does not add another event. Resetting to pending is an explicit revision. Importing an old CSV can replace later decisions; I export a fresh sheet first.

## Deduplication and decision conflicts

A union-find pass joins all occurrences sharing a PMID or normalized DOI, including transitive links. DOI normalization removes a leading `doi:`, `https://doi.org/`, or `http://dx.doi.org/`, trims whitespace, and ignores letter case. Empty DOIs never match each other. The first-seen record supplies the main PMID and populated metadata; later matches fill missing metadata, including missing abstracts. All PMIDs and source search IDs remain available.

The latest event for each PMID determines its current decision. If a new search links two groups with different decisions or reasons, report and CSV export fail with a conflict message. `decide` on any PMID in the group applies the chosen revision to every alias, retaining the earlier events. A shared DOI is a useful dedupe signal, not proof of an independent study; users should check corrections or related publications manually.

## Flow arithmetic

- Downloaded occurrences = records saved across every run, counting repeats.
- Duplicates removed = downloaded occurrences minus deduplicated groups.
- Records to screen = deduplicated groups, including records with no abstract.
- Records screened = included plus excluded.
- Pending = records to screen minus records screened.
- Exclusion-reason totals = excluded groups, each counted once.

The sum of API match counts is labeled `matched_across_queries_with_overlap`. It is never used as the screening denominator. `searches_truncated` reports incomplete retrieval; it does not estimate how many unique records were missed.

The report is PRISMA-style because it documents identification, deduplication and title/abstract screening. It does not claim a full PRISMA review, independent dual screening, risk-of-bias assessment, full-text eligibility, or a count of independent clinical studies. `included.csv` contains provisionally included publication records.

## Boundaries

The query builder does not lint arbitrary Boolean syntax or resolve MeSH headings; I inspect PubMed's interpreted query and warnings. The client rejects ESearch error lists, including unknown quoted phrases, rather than quietly treating an invalid search as empty. The example is a relevance-ranked sample, not a validated search strategy. A broader review would need synonyms, verified headings, date partitions, other databases, and a documented protocol.

The Python MIT license covers my code. PubMed record content comes from NCBI and publishers and may have its own rights; fixture records are attributed in the fixture notes. No private patient records or credentials are needed.
