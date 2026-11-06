# Finding the next troubleshooting step

I built a support assistant because I kept looking through separate setup guides
when a local feature stopped working. I can describe a problem and get the
relevant instructions with their source. It suggests steps for me to review; it
cannot change files, restore a backup, send a message or grant account access.

## Try it

With Node.js 24 or newer, from the repository root:

```sh
npm ci
npm run rag:download
npm run support -- "My retrieval embedding files are unavailable"
npm run support -- "How do I save a backup before an upgrade?"
npm run support -- "My backup has missing files"
```

The first two tickets return `suggested`, numbered passages and a source such as
`sop/retrieval`. The third returns `escalated`, with no proposed fix, because
missing files need the owner's review. Unknown topics and tickets mentioning
multiple topics also escalate. The output is JSON so a support screen or script
can read the category, priority, decision, citations and tool trace. This is a
local command, separate from the browser demo and its scripted support replies.

The approximately 23 MB model download happens once. After setup, embeddings
(lists of numbers representing text meaning), search and quoted replies work
offline on the CPU. I stop the command with Ctrl-C if needed. It normally exits
after one ticket and closes its model and temporary in-memory database.

## Optional written answers through Azure

The local path needs no account. For Azure OpenAI, I create a resource and deploy
a chat model in my own Azure account, then copy `.env.example` to `.env` and set:

```dotenv
LLM_MODE=real
LLM_PROVIDER=azure
LLM_BASE_URL=https://YOUR_RESOURCE.openai.azure.com
LLM_MODEL=YOUR_DEPLOYMENT_NAME
LLM_API_KEY=YOUR_AZURE_OPENAI_KEY
AZURE_OPENAI_API_VERSION=2024-10-21
```

I keep `.env` untracked. The base address is the resource root, and the model
value is the deployment name. The transport adds the deployment route and API
version and uses the `api-key` header, as described in the
[Azure REST reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference).
I run the same support command. The provider receives the ticket, configuration
readiness and retrieved public SOP passages. For saved-note questions in the
workspace, it instead receives the question and selected private passages when
I explicitly enable the real provider. Embedding and vector search stay local.

For an existing local chat endpoint, I use `LLM_PROVIDER=compatible` with its
`LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. That keeps the same tool and citation
checks. Setting `LLM_MODE=mock` restores the offline support workflow. No paid
service is needed to run the tests. Azure request handling is tested against
synthetic responses; I have not verified a live Azure deployment here.

## How I keep suggestions tied to instructions

The four approved procedures in `docs/support-sops/` cover retrieval, backups,
transcription and Microsoft 365 reminders. They point back to the full setup
guides. SOP means standard operating procedure: the steps I want to follow for
a repeated task. These files are indexed separately from private notes.

`src/support/assistant.mjs` runs a LangChain sequence, a series of connected
steps. First a conservative rule classifies the ticket. High impact, unknown or
mixed-topic requests escalate before any provider call. For the remaining
tickets, two schema-checked LangChain tools can run:

- `inspect_runtime` checks local embedding-file presence and selected provider;
  it does not read the workspace or claim the full system is healthy.
- `search_sops` searches only the approved category, using the shared local
  embedding model and sqlite-vec store. The model cannot choose another scope.

Without a chat provider, the router calls these tools in order and returns exact
passages. With a provider, the model chooses tool calls through the existing
bounded chat loop. It gets at most six rounds. Unknown tools, invalid arguments,
missing required checks or provider failures escalate. The reusable prompt in
`src/support/prompts.mjs` treats tickets and passages as untrusted reference text.

The final answer must cite a retrieved chunk and an exact quote in that chunk.
An invented citation or missing evidence escalates. This is a free, code-based
equivalent of a Copilot Studio-style tool-routing workflow; I have not used or
deployed Microsoft's Copilot Studio product for it. It is not a general help desk
and does not create tickets in another service. Escalation is a returned decision
for the owner to handle, not an automatically sent message.

Similarity and a valid quote do not prove that a suggested step solves the
problem. Category rules can miss unfamiliar wording, and a nearby passage can
pass the cutoff without answering the precise question. I read the quote before
acting. New categories need an approved SOP, routing rule and labelled examples.

## Repeatable checks

```sh
npm run test:support
npm run rag:download
npm run support:evaluate
npm run test:rag
npm test
npm run build
npm run lint
npm run typecheck
npm run privacy
```

The support/provider tests cover offline tools, category boundaries, missing
evidence, high impact escalation, Azure deployment URLs and authentication,
structured prompts, model allowlisting, errors, unknown tools and bounded loops.
`test/fixtures/support/tickets.json` labels 14 fictional tickets, including eight
with relevant procedures and six that should escalate. The evaluation uses the
actual local model, not synthetic vectors. It reports category accuracy, source
hit rate, decision accuracy and escalation recall in
`.runtime/retrieval/support-evaluation.json`. CI requires all categories correct,
at least seven of eight source hits, and all six uncertain tickets escalated.
This small regression set is not an estimate of accuracy on real support tickets.

The main CI suite runs the unit tests and existing Node/React tests. The dedicated
retrieval job downloads pinned weights on a Linux runner, exercises real offline
inference and browser citations, and uploads both labelled evaluation reports.
The Mac build does not need containers or model downloads.
