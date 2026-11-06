# Questions about my saved notes

I use this when I remember a topic but cannot remember which note explains it.
The command searches text I have saved in LifeOS, then shows useful quotes with
the note title, record ID and passage number. I can open that note in LifeOS and
check the surrounding explanation. It also works with saved lecture transcripts.

## Try it locally

This needs the local SQLite edition of LifeOS and Node.js 24 or newer. The
browser demo and PostgreSQL edition do not run this command.

1. Run `npm ci` and `npm run dev` from the checkout. Open
   <http://127.0.0.1:8787>, open **Notes**, and save a typed note. For example,
   save a note titled `Feedback loops` with this fictional study text:
   `A feedback loop uses the output of a system to influence its next input.
   Negative feedback reduces a deviation from the target.`
   The sample workspace also contains a note titled `Systems vocabulary`.
2. Install [Ollama](https://ollama.com/download), which runs language models on
   this computer. In another terminal, run `ollama serve`. If the Ollama app is
   already running its server, use that server instead.
3. Download the two models once:

   ```sh
   ollama pull nomic-embed-text
   ollama pull qwen2.5:1.5b
   ```

4. From the LifeOS checkout, run:

   ```sh
   npm run notes -- index
   npm run notes -- ask "How does negative feedback affect a deviation?"
   npm run notes -- ask "What is the capital of Peru?"
   ```

The first question should return a saved quote followed by `[1]` and a source
such as `Feedback loops (private-note:<record ID>, passage 1)`. The second
question should say `I don't know from my saved notes.` The command never
fills gaps with the model's general knowledge. It chooses exact quotes rather
than writing a new explanation; I still check whether those quotes answer my
question. A relevant result can be missed, and an irrelevant quote can still
pass the checks.

Both `index` and `ask` read the latest saved records. `ask` refreshes the index
when notes change, so a deleted note disappears on the next question. An
unchanged collection reuses its saved vectors. A model/server error exits with
an error and setup advice; that is different from a successful unknown answer.

Stop LifeOS and a terminal-started Ollama with Ctrl-C when finished. This
command exits after answering and does not start a background service. It asks
Ollama to unload each model after use.

## What gets searched

- Typed private notes (`private-note.text`).
- Study notes (`learning-note.text`).
- Saved lecture transcript segments (`lecture-transcript.segments`).

Journals, contacts, chat history, attachments, PDFs, handwriting images and
other records are excluded. There is no image recognition or PDF import here.
Save a typed explanation or make a [local transcript](whisper.md) first.
The command reads the workspace without changing it.

## Settings and storage

I can set these in the shell or the checkout's ignored `.env` file. Nothing
needs a hosted account or API key.

| Setting | Default | Purpose |
| --- | --- | --- |
| `LIFEOS_DATABASE` | `.local/workspace.sqlite` | Existing local workspace to read |
| `NOTES_INDEX` | `notes-index.sqlite` beside that workspace | Separate local search database |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama-compatible server |
| `NOTES_EMBED_MODEL` | `nomic-embed-text` | Model that represents passages as numbers |
| `NOTES_CHAT_MODEL` | `qwen2.5:1.5b` | Model that selects quoted answers |
| `NOTES_MIN_SCORE` | `0.65` | Minimum cosine similarity, from 0 to 1 |

The index holds copies of note text and vectors, lists of numbers representing
meaning. It is private data, just like the workspace. The default directory is
ignored by Git and index files are owner-readable/writable only. Keep backups
private. To erase the derived copy, stop the command and delete only
`notes-index.sqlite`; the next question builds it again. A custom index path
outside ignored directories needs its own backup and Git precautions.

Only HTTP loopback endpoints are accepted. Note text and questions go to that
server; the server is responsible for keeping processing local. Redirects are
rejected and inherited LangSmith tracing, an optional remote execution log, is
disabled for this command. Initial model downloads need internet access; asking
questions afterward needs only the local server. The feature does not change
LifeOS's separate assistant provider settings.

Changing the embedding model name or endpoint rebuilds the index. If I replace
weights behind the same model name, I delete the derived index to rebuild it.
If a refresh fails, the old snapshot stays intact but the command fails rather
than answering from stale text. Concurrent refreshes are not supported; I run
one command at a time. Large collections are slower because a changed
collection is fully re-embedded and similarity search scans its saved vectors.

## How it works

`src/notes/questions.mjs` loads supported records and uses LangChain's text
splitter to make passages of up to 1,000 characters with 150 characters of
overlap. LangChain connects the embedding model, local vector store, prompt,
chat model and JSON parser. This is retrieval-augmented generation: find source
text first, then give only those passages to the model.

`src/notes/vector-store.mjs` implements LangChain's `VectorStore` interface on
SQLite. It stores text, source metadata and vectors, ranks the four closest
passages by cosine similarity, a comparison of their vector directions, and
filters below the configured threshold. No passing passages means no chat call.
The score is a retrieval setting, not a probability that an answer is correct.

The model selects up to three quotes from the supplied passages. Every source
number and exact quote is checked against the retrieved text before anything
is shown. Missing evidence, malformed output, invented text or invalid source
numbers produce the unknown response. Quoting prevents invented wording but
cannot establish whether a note is true or a quote is relevant. Notes are
labelled as untrusted input in the prompt, and the model has no tools or write
access. I review the source before relying on an answer.

## Checks

```sh
npm run test:notes
npm test
```

The focused suite uses LangChain's fake chat model with deterministic vectors
and real temporary SQLite databases. It checks persistence, note changes,
deletions, failed refreshes, missing workspaces, relevance refusals and citation
validation. A local HTTP fixture runs the actual Ollama adapters through the
CLI, including caching and an unrelated question, without downloading weights.
Its server and databases close in cleanup even after a failure. The dedicated
`Notes questions` CI job runs these checks without a model service.

I also checked real local inference with `nomic-embed-text` and `qwen2.5:1.5b`
on three fictional notes on November 6, 2026. A question about negative feedback
returned the matching sentence with its note citation in 1.80 seconds. A question
about what to bring to a lab returned the preparation note with its citation in
1.87 seconds. An unrelated question about Peru returned the unknown answer in
0.43 seconds. That is two supported questions and one refusal, not a broad
accuracy benchmark. The temporary model server exited, its port closed, and its
separate downloaded weights and fixture databases were removed afterward.
