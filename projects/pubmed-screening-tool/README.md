# pubmed-screening-tool

I built a PubMed search and screening tool to learn how the underlying idea works. This is a learning project.

## My worked example

My question is: **What inhaler design and usability factors help adults with asthma or COPD use their medication correctly?** COPD is a long-term lung condition. I use this question to explore a device used to deliver medication, rather than compare which medication works best.

I combine **MeSH terms**, the standard subject labels used by PubMed, with words found in titles and abstracts:

```text
("Metered Dose Inhalers"[MeSH Terms] OR inhaler[tiab])
AND (usability[tiab] OR "human factors"[tiab] OR "handling errors"[tiab])
```

`OR` accepts alternatives; `AND` requires both groups. `[tiab]` searches titles and abstracts. The free-text inhaler term helps find papers that do not yet have subject labels. The exact one-line query is in [examples/query.txt](examples/query.txt).

The saved NCBI response captured on **6 November 2026 UTC** returned **115 matches**. I downloaded the first six relevance-ranked records to keep this demonstration small. The example replays that same search twice to show what happens when a paper is downloaded again:

| Step | Count |
| --- | ---: |
| Downloaded record occurrences | 12 |
| Duplicate occurrences removed | 6 |
| Unique records to screen | 6 |
| Included after reading title and abstract | 2 |
| Excluded with a reason | 4 |
| Still pending | 0 |

For this exercise, I keep device-focused design and handling reviews, and exclude papers mainly about sustainability, general adherence, combat analgesia, or telehealth workflow. These are illustrative human screening choices, saved in [examples/decisions.csv](examples/decisions.csv), not an automated judgment of paper quality.

The two retained papers discuss [patient handling and feedback in an inhaler](https://pubmed.ncbi.nlm.nih.gov/31264482/) and [human factors in dry powder inhaler design](https://pubmed.ncbi.nlm.nih.gov/38630860/). Both still need full-text assessment. This is a small search and title/abstract exercise, not a completed systematic review or medical advice. The 115 matches are not the number screened, and adding the two searches' match counts double-counts overlapping results.

## Run my own search

For a live search, I set an NCBI contact email locally. An API key is optional. Neither value is saved in the search archive.

```sh
export NCBI_EMAIL='your-contact-email@example.org'
pubmed-screen search --db review.sqlite \
  --query-file examples/query.txt --max-records 200
pubmed-screen screening --db review.sqlite --output screening.csv
```

I open `screening.csv`, read each title and abstract, and edit the `decision` and `reason` columns. A decision is `include`, `exclude`, or `pending`; both include and exclude require a reason. I leave the PMID, PubMed's record identifier, unchanged. Then I import the decisions and create my report:

```sh
pubmed-screen import-screening --db review.sqlite --input screening.csv
pubmed-screen report --db review.sqlite --out review-output
```

I can also make or revise a single decision:

```sh
pubmed-screen decide --db review.sqlite --pmid 31264482 \
  --decision include --reason 'Inhaler feedback and patient handling'
pubmed-screen history --db review.sqlite
```

To undo a decision, I set it to `pending`. The earlier decision remains in the history. A CSV import applies every row, including pending rows, so I export a fresh screening sheet before editing an ongoing review.

## Build and inspect a query

I can write any PubMed Boolean string directly with `search --query '...'`, or use the query builder:

```sh
pubmed-screen build-query --mesh 'Metered Dose Inhalers' \
  --boolean '(usability[tiab] OR "handling errors"[tiab])' > my-query.txt
pubmed-screen search --db review.sqlite --query-file my-query.txt --max-records 100
pubmed-screen queries --db review.sqlite
pubmed-screen search-detail --db review.sqlite --id 1 --output search-1.json
```

Repeating `--mesh` joins related headings with OR; the Boolean expression is then joined with AND. For separate required concepts, I put the complete grouped query in a file, as in the worked example. The builder does not verify that a heading exists in MeSH. The query log retains PubMed's interpreted query and any warnings so I can check how the search was understood.

The default download cap is 200 per search. Every run records the full match count, the cap, the actual download count, the UTC time, and whether retrieval was capped. The tool supports up to 9,999 records in one run; I split larger searches into explicit date ranges. A capped search is not a complete search. Live results can change as PubMed is updated.

## What I save

- `review.sqlite`: search text, dates, interpreted queries, raw API responses, downloaded records, and dated screening history. I keep this local and back it up between sessions.
- `screening.csv`: one row per deduplicated record, including the abstract, all matching PMIDs, source search IDs, decision, and reason.
- `review-output/included.csv`: records included at the title/abstract stage, with links back to PubMed and their search IDs.
- `review-output/flow.txt` and `flow.json`: readable and machine-readable PRISMA-style counts. PRISMA is a reporting framework for showing how records move through a review.
- `review-output/queries.json`: the search log, including retrieval limits and whether each run was live or replayed.

The flow stops at title/abstract screening. It does not invent full-text retrieval, eligibility, or final-study counts. Records without abstracts remain pending until I decide what to do with them. CSV cells that could be interpreted as spreadsheet formulas are exported as text.

## How I put it together

I use NCBI E-utilities, PubMed's programming interface: ESearch finds record identifiers and EFetch downloads the records and abstracts. The client batches downloads, spaces requests below three per second, and retries temporary failures up to three attempts. If a requested record is missing or the API returns an error, it does not save a partial search.

Duplicate detection joins records with the same PMID or DOI, a publication identifier, including DOI links and differences in letter case. It follows linked matches across searches, keeps the first-seen PMID as the main identifier, and preserves all aliases and search sources. Conflicting screening decisions on newly linked duplicates stop reporting until I resolve the group with `decide`. Matching identifiers can also link related publications, so I still check these groups manually.

The code has no runtime packages beyond Python's standard library. [docs/design.md](docs/design.md) explains the archive, count definitions, and boundaries. [The fixture notes](tests/fixtures/inhaler/README.md) explain where the recorded responses came from. I follow the [NCBI E-utilities guide](https://www.nlm.nih.gov/dataguide/eutilities/utilities.html) and [PubMed search guide](https://pubmed.ncbi.nlm.nih.gov/help/) for the API and query syntax.

## Tests and limits

There are 3 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: (removed workflow).

Contact email addresses in dependency notices or public-data fixtures were replaced with a fictional example address in this snapshot.

The relocated workflow failed in GitHub Actions and was removed to keep the hub checks independent. Local test sources remain available.
