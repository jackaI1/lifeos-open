# Tool-use evaluation report

Backend: scripted

Model: oracle fixture (mixed), not an LLM

Tasks: 40 | Runs: 120 | Repeats: 3

| Measure | Score |
| --- | ---: |
| tool_selection | 98.3% |
| argument_validity | 98.3% |
| argument_accuracy | 96.7% |
| answer_accuracy | 98.3% |
| pass_rate | 95.8% |
| consistency | 95.8% |

Argument validity means every attempted call met its JSON schema. A missing call is caught by tool selection and argument accuracy. Consistency is the most common completed tool trace and answer divided by all repeats, averaged over tasks. It does not measure correctness; a single repeat is N/A.

## Failures by category

| Category | Failed runs |
| --- | ---: |
| answer_accuracy | 2 |
| argument_accuracy | 4 |
| argument_validity | 2 |
| malformed_call | 1 |
| tool_selection | 2 |

One run may fail several categories.

## Failed runs

| Task | Repeat | Categories | Attempted tools | Final answer |
| --- | ---: | --- | --- | --- |
| task-01 | 1 | argument_accuracy, tool_selection | ticket_get | 300 |
| task-02 | 1 | argument_accuracy, argument_validity | calculator | 24 |
| task-03 | 1 | argument_accuracy | calculator | 2400 |
| task-04 | 1 | answer_accuracy | calculator | "incorrect" |
| task-05 | 1 | answer_accuracy, argument_accuracy, argument_validity, malformed_call, tool_selection | None | None |

## Reproduction settings

```json
{
  "backend": "scripted",
  "base_url": null,
  "dataset_sha256": "72875e2b53317ce0d921849aaf5caa56f04cb0737ab1a6fcc4d02fdb68d33f03",
  "max_calls": 16,
  "max_turns": 8,
  "model": "oracle fixture (mixed), not an LLM",
  "repeats": 3,
  "seed": 0,
  "temperature": 0.2,
  "think": null,
  "timeout_seconds": 30,
  "timestamp_utc": "2026-11-06T05:34:11.022920+00:00",
  "tools_sha256": "8bcbaf0006eac0f98dde0dd3218cb98c00a8cd5932c905b8222c3155e1a0c44a",
  "world_sha256": "bb8993e7e66c53dc2e8e2d3f929b43859acdd5561e47c5bca956ed59d085bbb0"
}
```

See runs.csv for every run and traces.json for tool arguments, results and messages.
