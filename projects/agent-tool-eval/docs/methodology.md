# Evaluation method

I use a small, versioned maintenance workload to compare tool-use behaviour under the same conditions. All names, records and tickets are synthetic. This is a constrained regression benchmark, not an estimate of general assistant quality.

## Conversation contract

The runner sends a fixed system message, one task prompt and five native function declarations. A model responds with Ollama assistant messages. Tool calls have this shape:

```json
{"role":"assistant","content":"","tool_calls":[{"function":{"name":"calculator","arguments":{"expression":"6 * 7"}}}]}
```

`arguments` must be a JSON object, not a JSON string containing an object. The runner checks each call against its declared JSON Schema before executing it. It appends the actual result as a `role: tool` message with `tool_name` and JSON-encoded `content`, then asks the model to continue. Calls within a single message execute in order. A final assistant message has no tool calls and contains only the requested value.

Unknown tools, schema violations and execution errors are recorded. Invalid calls never execute. Valid calls later in the same conversation may recover, but the earlier failure still prevents an overall pass. Structurally malformed calls stop the conversation because there is no reliable tool name to answer. Messages nested more than 64 levels deep are rejected before copying or execution. The model adapter makes bounded, non-streaming HTTP requests; it does not retry failed requests invisibly.

## Reference data

Each dataset row contains a unique ID, a category, a prompt, an ordered `expected_calls` list, and an answer matcher:

```json
{
  "id": "example-01",
  "category": "calculator",
  "prompt": "Use the calculator with expression 6 * 7. Return only the number.",
  "expected_calls": [{"name":"calculator","arguments":{"expression":"6 * 7"}}],
  "answer": {"kind":"number","value":42}
}
```

A dataset is a non-empty JSON array. `kind` may be `text`, `number` or `json`; the loader checks its shape, unique IDs, answer types and reference tool schemas. The packaged dataset has exactly 40 tasks. A custom dataset may have a different count. Reference calls and answers stay in the evaluator, outside the model request. The test suite executes every packaged reference and checks its answer against the fixture records, in addition to the oracle replay.

`world.json` defines the five file records and four starting tickets. `file_lookup` looks up a filename in that dictionary; it does not read arbitrary files. Unknown but well-formed filenames and ticket IDs return `{"error":"not_found"}`. Ticket changes persist through one conversation and reset before the next task or repeat. Search filters combine with AND and results are sorted by ID.

## Scoring

Each run has four binary checks, all weighted equally when reported individually:

1. Tool selection compares the complete ordered list of attempted names, including duplicates, with the reference. Empty references require no calls.
2. Argument validity requires every attempted call to use a declared tool and satisfy its schema. No calls is vacuously valid. Malformed calls fail validity.
3. Argument accuracy compares canonical JSON for the ordered calls and their complete inputs. Object key order is ignored; string contents, numeric representation and list order remain strict. Missing and extra calls fail.
4. Answer accuracy checks the final value independently. Text ignores case and repeated whitespace, whether plain or JSON-quoted. Numeric answers must be bare JSON numbers, never booleans or prose containing a number; both absolute and relative tolerance are `1e-6`. JSON answers compare canonical structures, preserving array order and distinguishing booleans from numbers.

The overall pass requires all four checks and no other failure. Category counts overlap: one run can have a wrong tool, wrong arguments and a wrong answer. A schema-valid expression that fails at execution gets `tool_execution`; endpoint, protocol and budget failures have separate labels. Scores are run-level proportions, not a hidden blended score. Every task gets the same number of repeats and equal weight.

## Consistency

For each task, I canonicalize the completed sequence of tool names and arguments with the normalized final answer. I divide the largest group of identical fingerprints by the total number of requested repeats. The summary averages those fractions across tasks. Tool results and prose surrounding tool calls are not part of the fingerprint.

A three-repeat task with outputs A, A, B has consistency 2/3. A, A, endpoint failure also has 2/3, because a missing completion stays in the denominator. Three endpoint failures score zero consistency. Three identical wrong answers can score 100% consistency and 0% accuracy. With only one repeat, consistency is null in JSON/CSV and N/A in Markdown. It is descriptive agreement, not a statistical confidence estimate.

## Reproduction and limits

Seeds are `base seed + repeat index`, with indices starting at zero; each task uses the same repeat seeds. Each conversation gets a new sandbox and message history. Reports record UTC time, model name, server root, temperature, thinking setting, request timeout, repeat seeds, call/turn budgets and SHA-256 hashes of the task data, world and declarations. The server may ignore seeds or sample differently across versions. When publishing a real-model run, I also save the server version and model digest alongside the report.

The `scripted` backend is an oracle fixture: it reads expected calls and answers. The `perfect` profile should pass all references. The `mixed` profile corrupts one repeat for each of the first five tasks when its seed is divisible by three. Those faults cover wrong tool, schema error, wrong allowed argument, wrong answer and malformed call. Its results must never be presented as a language model benchmark.

The workload is intentionally small, English-only and often explicit about the expected call. It does not check arbitrary natural-language paraphrases, equivalent alternative call plans, real ticket permissions, parallel tools, malicious tool data or long-horizon planning. A different equivalent expression can receive a correct answer score but a failed argument score. These choices keep regressions explainable without a second model acting as judge.
