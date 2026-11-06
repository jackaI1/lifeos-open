# Answers from my saved text

I wanted to ask what I had already written down without opening every note or
reading an entire calendar. The local assistant can now find relevant passages
in saved notes and calendar entries and show where its answer came from. It
says it does not know when nothing passes the relevance cutoff.

## Try it

From a checkout with Node.js 24 or newer:

```sh
npm ci
npm run rag:download
RAG_MODE=local npm run dev
```

The download step fetches about 23 MB of public model files into
`.cache/retrieval-model`. Afterward, retrieval runs on the CPU without a network
connection. Open <http://127.0.0.1:8787/#school?assistant=new>, or use
**School → Academic advisor**. Type these questions:

1. `What should I bring to the Systems lab?` returns the fictional calendar
   instructions, Room S-204 and a numbered source.
2. `How does feedback influence a system input?` finds the saved study notes.
3. `Who won the 1987 Antarctic chess championship?` says it does not know.

I can edit text in **Notes**, save it, and ask about it in the advisor. The next
question updates changed passages and removes deleted or archived records from
the search index. Today also accepts saved-text questions. In a **Lecture Tutor**
conversation, retrieval is restricted to entries carrying that lecture's course
ID; personal notes without a course ID are excluded there. Retrieval reads saved text,
not the visible notebook image. If a recovered draft contains photos, I can remove
them with the visible remove buttons before sending; the draft stays saved until
I choose what to do with it.

Stop with Ctrl-C. The static [browser demo](https://lifeos.jacklai.ca) still uses
authored example questions. It does not download this model or run SQLite search
in the browser. Finance, Support and project preparation keep their existing behavior.

## What an answer means

Without a chat provider, the assistant returns verbatim passages labelled
**Saved passage [1]**, followed by their titles, record identities and text
offsets. This mode finds evidence; it does not pretend to write a new explanation.
The source identity tells me which note or calendar entry to check. Citations
are text references, not navigation links.

With `LLM_MODE=real` and the provider settings from `.env.example`, the same
retrieval runs first. Only the top matching text passages and the question go
to the configured chat endpoint. The provider returns short claims, each with a
chunk ID and an exact supporting quote. LifeOS checks that the ID was retrieved
and that the quote exists in that passage. It displays each claim, quote and
numbered source together. Invalid citation output or a provider failure falls
back to the verbatim passages; an empty claims array says it does not know.

Citation validation proves that the quote exists, not that every generated
claim follows logically from it. I still read the quote. A similarity score is
also not a probability that an answer is correct. A nearby topic can pass the
cutoff without containing the particular fact I wanted.

If no chunk passes the cutoff, LifeOS skips the chat provider entirely and
answers **I don't know from the saved notes and calendar entries**. Missing
model files or an unavailable index also fail closed, with a setup hint. They
never fall back to a scripted answer that could look grounded.

## What stays on my computer

The index includes `learning-note` text or definitions, `private-note` text, and
calendar descriptions, locations and start/end times. Titles accompany each
passage during embedding. It excludes archived/deleted records and cancelled
events. It does not read handwriting, photos, attachments, journals, chat
history, task lists or finance records. Saved text is treated as reference data,
never as instructions to the assistant.

Both embedding and vector search stay local. A real chat provider receives
retrieved passages only if I configure it; those passages can contain private
text. The vector database itself contains copied source text and should receive
the same protection as the workspace. It and the model cache are ignored by Git.

## Configuration and storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `RAG_MODE` | unset | Set `local` to enable retrieval for supported assistant scopes. |
| `RAG_THRESHOLD` | `0.40` | Minimum cosine similarity; values must be greater than 0 and at most 1. |
| `RAG_DATABASE` | workspace filename plus `.retrieval.sqlite` | Separate, derived SQLite index. In-memory test workspaces use an in-memory index. PostgreSQL workspaces default to `.local/retrieval.sqlite`. |
| `RAG_MODEL_CACHE` | `.cache/retrieval-model` | Directory containing the downloaded model files. |

`rag:download` uses the default model cache. If I choose another cache location,
I move the downloaded directory there and set `RAG_MODEL_CACHE` when starting.
I give each workspace its own `RAG_DATABASE`, especially when using multiple
PostgreSQL workspaces. One running service owns each index. The index is not
part of a backup because the current saved records can rebuild it. To erase it,
I stop LifeOS and remove only the configured retrieval database, then restart.

## Design

`src/local/retrieval-model.mjs` loads
[all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), a sentence
embedding model, through Transformers.js 4.3.2 and ONNX Runtime on the CPU. The
weights are pinned to revision `751bff37182d3f1213fa05d7196b954e230abad9`
and use 8-bit quantization, smaller numerical weights. Mean pooling combines
the token outputs into one 384-number vector; normalization makes its length one.
Two inference threads limit contention with the rest of the workspace.

`src/local/retrieval.mjs` splits source text into windows of at most 480 UTF-16
code units with 80 units of overlap, so a boundary does not lose all nearby
context. This is a character bound, not a token guarantee; unusually dense text
can reach the embedding model's token limit. Each chunk carries the source ID,
title and original offsets. Content hashes reuse unchanged embeddings. Model,
weight, pooling or chunk-policy changes invalidate the derived index.

Each question reads the current eligible records, embeds changed chunks in
batches of 16, then updates SQLite in a transaction. Inference completes before
any replacement, so a failed refresh cannot partly replace the index. The caller
does not search an old index after a refresh failure. Lecture queries filter by
course before ranking. Search computes cosine similarity, a measure of vector
direction, sorts descending with deterministic ties, and returns up to three
chunks scoring at least 0.40. An exact scan is simple for a personal workspace;
large archives would need indexed vector search and incremental background work.

`retrieval-workspace.mjs` owns the model and index lifecycle. `service.ts` opens
that capability only when requested and closes it with the service.
`services.ts` routes supported assistant jobs through retrieval before any chat
request and saves citation metadata alongside the reply. Existing project,
finance and scripted-demo paths remain covered by the regular suite.

## Repeatable checks

```sh
npm run rag:download
npm run test:rag
npx playwright install chromium
npm run test:rag:browser
npm test
npm run build
npm run lint
npm run typecheck
npm run privacy
```

Ten retrieval checks cover chunk coverage/overlap, cosine ranking, persistence,
cache reuse, edits/deletion, failed refreshes, model changes, course filtering,
invalid citations, failed initialization cleanup, offline inference, a configured chat transport and the
no-match path. The browser check types questions in desktop and phone layouts,
checks visible citations and abstention, preserves the finance demo, and closes
its server and browser in `finally` with process/port evidence. The full suite
passes 346 Node tests and 19 React tests, with three optional Node tests skipped.

`test/fixtures/retrieval/questions.json` contains ten fictional records and 18
manually labelled questions. `npm run rag:evaluate` runs the actual downloaded
model and reports recall at one and three after thresholding. Recall at k is
the fraction of labelled relevant source records present in the first k chunks,
averaged across answerable questions. The result is 12/14 (85.7%) for both k=1
and k=3, and 4/4 unknown questions abstain. The design-group question and recovery
run question miss the cutoff and also abstain. I keep those misses in the report.

This small English set is a regression check, not a representative benchmark.
The cutoff is conservative and configurable; it has not been calibrated against
a separate held-out workspace. CI requires at least 80% recall at one and three
and complete abstention on these four unknowns. Its dedicated retrieval job
downloads weights in setup, tests offline inference, runs the real assistant and
browser, and uploads `.runtime/retrieval/evaluation.json` for inspection.
