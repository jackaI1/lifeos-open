# Finding a passage in a shift report

I wanted to compare word search with search by meaning, so I wrote eight
synthetic shift reports and technical notes. I can ask what fixed the water
pump's vibration and get the exact passage, document and shift. If the closest
passage is weak, the service says it does not have a strong enough source.
These examples are fictional and are separate from personal notes.

On Linux or another machine with Docker:

```sh
docker compose -p shifts -f compose.shift-search.yaml up --build --wait
curl -H 'content-type: application/json' -d '{"question":"What fixed pump P-12 vibration?"}' http://127.0.0.1:8793/search
docker compose -p shifts -f compose.shift-search.yaml down --volumes
```

The first build downloads the same pinned local open embedding model used in
LifeOS's [saved-text search](retrieval.md). An embedding is a list of numbers
representing a passage. Afterwards it runs locally with remote model reads
disabled. PostgreSQL stores 384-number vectors with pgvector, a database
extension for similarity search. A generated `tsvector` column and a GIN index
provide full-text word search. The migration also creates a vector index.

The search retrieves both rankings and combines them with reciprocal rank
fusion: each rank contributes `1 / (60 + rank)`. Results are stable on ties.
A configurable similarity cutoff of 0.35 decides whether the leading source is
strong enough. The answer is copied from that source passage; it is not an
uncited model completion. Model identities are stored and matched during search
to keep vectors from incompatible models separate.

The ten labelled questions include eight known sources and two unrelated
questions. CI runs the actual model, PostgreSQL text search, vector distance and
fusion, and uploads recall at three for full-text only, vector only and combined
search in `shift-search-evaluation`. Recall at three means the expected passage
appeared among the first three candidates. In the first CI run, full-text recall at three was 5/8 (62.5%), while vector
and combined retrieval each found 8/8 (100%). Both unrelated questions were
declined. This small set checks regressions,
not broad retrieval quality; fusion is not guaranteed to outperform both inputs.
The test also requires abstention on both unrelated questions.

To repeat without Compose, set `SHIFT_DATABASE_URL` to a PostgreSQL instance
with pgvector, install `services/shift-search/requirements.txt`, run
`npm run rag:download`, start `node tools/shift-embeddings.mjs`, then run
`python -m pytest -q services/shift-search`. Stop the owned embedding process
with Ctrl-C. The API is a local example; do not expose it without authentication.
