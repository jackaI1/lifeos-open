# Recorded PubMed responses

These are real public E-utilities responses, captured on 6 November 2026 UTC for the inhaler usability question in the main README. The fixture is a small relevance-ranked sample, not a complete literature review.

`manifest.json` stores the exact public endpoint parameters, UTC capture time, and SHA-256 checksums. `esearch.json` reports 115 matches and the first six PMIDs. `efetch.xml` contains the corresponding six records with abstracts and metadata, without editing their content. The manifest contains no API key, contact email, or credentials.

Source endpoints:

- https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
- https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi

The request parameters are preserved in the manifest instead of duplicating a long query URL here. `ReplayTransport` verifies parameters and checksums before returning the saved bytes. Offline tests exercise the same parsing code as a live search. Additional edge-case tests use small synthetic responses, explicitly constructed in the tests.

The records have PMIDs 32500439, 31264482, 38059011, 38412526, 38630860 and 41348960. The full publication links and metadata are included in CSV output. Abstracts and publication metadata retain their original attribution and publisher rights; the repository's MIT license applies to my code, not a reassignment of rights to those records.
