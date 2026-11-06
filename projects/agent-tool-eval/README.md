# agent-tool-eval

I built a program that checks how an AI assistant uses tools to learn how the underlying idea works. This is a learning project.

## What I look for

I score these separately so that one good result cannot hide another problem:

| Check | What it tells me |
| --- | --- |
| Tool selection | Did the assistant choose the expected tools, in order, without extras? |
| Argument validity | Did every attempted call follow its JSON schema, the rules for required fields and value types? |
| Argument accuracy | Did the call inputs match the reference, rather than just being allowed inputs? |
| Answer accuracy | Did the final value match the known answer? |
| Overall pass | Did all four checks pass without conversation or execution errors? |
| Consistency | How often did the most common completed call sequence and answer recur? |

A model can be consistently wrong. I keep consistency separate from its pass rate. If a task gets no calls, input validity is true because there are no invalid inputs; the missing calls still fail tool selection and argument accuracy.

## Sample report

Here is an excerpt from my [scripted failure demonstration](examples/scripted-mixed/report.md), with 40 tasks repeated three times:

| Measure | Score |
| --- | ---: |
| Tool selection | 98.3% |
| Argument validity | 98.3% |
| Argument accuracy | 96.7% |
| Answer accuracy | 98.3% |
| Overall pass | 95.8% (115 of 120 runs) |
| Consistency | 95.8% |

One injected call has a valid calculator input but uses `1 + 1` where the task requires `2.4 * 1000`. Its schema check passes and its argument accuracy fails. Another gives a number instead of an expression string, which fails the schema check. The report lists each failure by category, task and repeat.

## Run an actual assistant

I use Ollama, a program that runs language models locally, through its [native chat API](https://docs.ollama.com/api/chat). Install [Ollama](https://ollama.com/download), start it, then run:

```sh
ollama pull qwen3:0.6b
agent-tool-eval --backend ollama --model qwen3:0.6b --no-think \
  --base-url http://127.0.0.1:11434 --repeats 3 --seed 0 \
  --temperature 0.2 --out reports/local
```

If the service is not already running, I run `ollama serve` in a separate terminal. `--no-think` requests that the model skip its separate reasoning output, so the response budget is available for calls and answers. I use a small model to keep the run practical on a laptop; the harness does not require this particular model. When finished, `ollama stop qwen3:0.6b` unloads it; Ctrl-C stops a server started in a terminal.

A different server must accept Ollama's `/api/chat` request and tool-message format. `--base-url` is the server root, not the complete chat URL. For a protected endpoint, I set `AGENT_EVAL_API_KEY` in my environment; it is never written to the report. Tasks and tool results are sent to whichever endpoint I choose.

## Reports and comparisons

Each run writes:

- `report.md`: scores, failure counts and a table of failed runs.
- `runs.csv`: one row per task and repeat, including each independent check.
- `traces.json`: the complete conversation, attempted arguments, tool results and reproduction settings.

I can compare two models by using separate output folders with the same dataset, repeat count, seeds, temperature and budgets. The report records fingerprints of the dataset, tool definitions and sandbox records so I can see whether those inputs changed. A seed requests repeatability from the server; it does not guarantee identical output on different hardware or versions.

```sh
agent-tool-eval --backend scripted --repeats 3 --fail-under 1 --out reports/check
agent-tool-eval --help
```

`--fail-under 1` returns exit code 1 unless every run passes. Without that option, a completed report returns 0 even when the model scores poorly. Invalid configuration returns 2. The defaults allow eight assistant turns, sixteen tool calls per task and thirty seconds per HTTP request; I can change them with `--max-turns`, `--max-calls` and `--timeout`. A single repeat reports consistency as unavailable.

## How I put it together

The five declared functions cover three kinds of tools: `file_lookup`, `calculator`, and `ticket_get` / `ticket_search` / `ticket_update`. The file tool reads only named synthetic records, never the computer's files. The calculator parses arithmetic into an expression tree and allows only basic operations, with size and result limits. Every task and repeat starts with fresh ticket state.

The [40-task dataset](src/agent_tool_eval/data/tasks.json) contains 12 calculator tasks, 10 file lookups, 10 ticket tasks, four multi-step tasks and four tasks requiring no tools. I can pass a different dataset with `--dataset path/to/tasks.json`; its format and the scoring rules are in [docs/methodology.md](docs/methodology.md).

I intentionally use strict reference call sequences and arguments. An equivalent calculation written differently can fail the argument check, even if its answer is correct. Many prompts specify exact calls, so this measures constrained tool use and instruction following, not broad reasoning or production readiness. Text comparisons ignore case and surrounding whitespace; numbers use a small tolerance; JSON arrays preserve order. I do not use another model to judge answers.

The package separates [tools](src/agent_tool_eval/tools.py), [model adapters](src/agent_tool_eval/models.py), the [conversation and scoring loop](src/agent_tool_eval/runner.py), and [report output](src/agent_tool_eval/reports.py). The adapter sees prompts and tool declarations, never the reference calls or answers. The scripted adapter is the explicit exception used to test the harness.

## Tests and limits

There are 3 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: (removed workflow).

The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.
