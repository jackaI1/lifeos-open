# Tool-use evaluation report

Backend: ollama

Model: qwen3:0.6b

Tasks: 40 | Runs: 120 | Repeats: 3

| Measure | Score |
| --- | ---: |
| tool_selection | 10.0% |
| argument_validity | 100.0% |
| argument_accuracy | 10.0% |
| answer_accuracy | 1.7% |
| pass_rate | 1.7% |
| consistency | 79.2% |

Argument validity means every attempted call met its JSON schema. A missing call is caught by tool selection and argument accuracy. Consistency is the most common completed tool trace and answer divided by all repeats, averaged over tasks. It does not measure correctness; a single repeat is N/A.

## Failures by category

| Category | Failed runs |
| --- | ---: |
| answer_accuracy | 118 |
| argument_accuracy | 108 |
| tool_selection | 108 |

One run may fail several categories.

## Failed runs

| Task | Repeat | Categories | Attempted tools | Final answer |
| --- | ---: | --- | --- | --- |
| task-01 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"total": 300} |
| task-01 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 300} |
| task-01 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 300} |
| task-02 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 18.5} |
| task-02 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 18.0} |
| task-02 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 18.5} |
| task-03 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 2400} |
| task-03 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 2400} |
| task-03 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 2400} |
| task-04 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": "7.5"} |
| task-04 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": "7.5"} |
| task-04 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 7.5} |
| task-05 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 210} |
| task-05 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 210} |
| task-05 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 210} |
| task-06 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 56.5} |
| task-06 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": "56.5"} |
| task-06 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 56.5} |
| task-07 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 12} |
| task-07 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 12} |
| task-07 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 12} |
| task-08 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 2} |
| task-08 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": -4} |
| task-08 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 2} |
| task-09 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"result": 84} |
| task-09 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": 84} |
| task-09 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": 84} |
| task-10 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 252} |
| task-10 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"expression": "240 * 1.05"} |
| task-10 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"expression": "240 * 1.05"} |
| task-11 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 0} |
| task-11 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 0} |
| task-11 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 0} |
| task-12 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 5} |
| task-12 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 5} |
| task-12 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"number": 5} |
| task-13 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"sensor_count": 15} |
| task-13 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"sensor_count": 15} |
| task-13 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"sensor_count": 15} |
| task-14 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "file_lookup", "arguments": {"path": "inventory.json"}} |
| task-14 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "file_lookup", "arguments": {"path": "inventory.json"}} |
| task-14 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "file_lookup", "arguments": {"path": "inventory.json"}} |
| task-15 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"unit_cost": 100} |
| task-15 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"unit_cost": 100} |
| task-15 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"unit_cost": 100} |
| task-16 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": "inspection_day"} |
| task-16 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": "inspection_day"} |
| task-16 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": "inspection_day"} |
| task-17 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"interval_days": "2023-04-01T00:00:00Z"} |
| task-17 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"interval_days": "2023-04-01 00:00:00"} |
| task-17 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"interval_days": "2023-04-01T00:00:00Z"} |
| task-18 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "limits.json", "arguments": {"path": {"path": "max_temperature_c"}}} |
| task-18 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": 25.0} |
| task-18 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": "35.2"} |
| task-19 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": "500000"} |
| task-19 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": 5000} |
| task-19 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"value": "1000000"} |
| task-20 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"sample_count": 10} |
| task-20 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"sample_count": 10} |
| task-20 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"sample_count": 15} |
| task-21 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"revision": "1234567890"} |
| task-21 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"revision": "1234567890"} |
| task-21 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"revision": "1234567890"} |
| task-22 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"owner": "user"} |
| task-22 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"owner": "user"} |
| task-22 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"owner": "user"} |
| task-23 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-101"}} |
| task-23 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | <tool> {"name": "ticket_get", "arguments": {"id": "T-101"}} </tool> |
| task-23 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-101"}} |
| task-24 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-102"}} |
| task-24 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | <tool> {"name": "ticket_get", "arguments": {"id": "T-102"}} </tool> |
| task-24 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-102"}} |
| task-25 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-103"}} |
| task-25 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | <tool> {"name": "ticket_get", "arguments": {"id": "T-103"}} </tool> |
| task-25 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-103"}} |
| task-26 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-104"}} |
| task-26 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-104"}} |
| task-26 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_get", "arguments": {"id": "T-104"}} |
| task-27 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "123", "status": "open"} ``` |
| task-27 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_search", "arguments": {"priority": "open", "status": "open"}}} |
| task-27 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "123", "status": "open"} ``` |
| task-28 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "123", "status": "closed"} ``` |
| task-28 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_search", "arguments": {"priority": "high"}}} |
| task-28 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "123", "status": "closed"} ``` |
| task-29 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "1234567890", "status": "closed"} ``` |
| task-29 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"id": "1234567890", "status": "closed"} |
| task-29 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "123456", "status": "closed"} ``` |
| task-30 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | <tool> {"name": "ticket_search", "arguments": {"priority": "low", "status": "open"}} </tool> |
| task-30 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | <tool> {"name": "ticket_search", "arguments": {"priority": "low", "status": "open"}} </tool> |
| task-30 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | ```json {"id": "123", "id": "456"} ``` |
| task-31 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_update", "arguments": {"id": "T-101", "status": "closed"}} |
| task-31 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_update", "arguments": {"id": "T-101", "status": "closed"}} |
| task-31 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "ticket_update", "arguments": {"id": "T-101", "status": "closed"}} |
| task-32 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"error": "T-999. Error: Not found."} |
| task-32 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"error": 404} |
| task-32 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"error": "T-999. Error: Not found."} |
| task-33 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "Read a synthetic JSON file by name", "arguments": {"path": "inventory.json"}} |
| task-33 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "Read a synthetic JSON file by name", "arguments": {"path": "inventory.json"}} |
| task-33 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "Read a synthetic JSON file by name", "arguments": {"path": "inventory.json"}} |
| task-34 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "calculator", "arguments": {"expression": "120 - 9"}} |
| task-34 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "calculator", "arguments": {"expression": "120 - 9"}} |
| task-34 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"name": "calculator", "arguments": {"expression": "120 - 9"}} |
| task-35 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"status": "closed"} |
| task-35 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"status": "closed"} |
| task-35 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"status": "closed"} |
| task-36 | 1 | answer_accuracy, argument_accuracy, tool_selection |  | {"revision": "1234567890"} |
| task-36 | 2 | answer_accuracy, argument_accuracy, tool_selection |  | {"revision": "1234567890"} |
| task-36 | 3 | answer_accuracy, argument_accuracy, tool_selection |  | {"revision": "1234567890"} |
| task-37 | 1 | answer_accuracy |  | {"word": "ready"} |
| task-37 | 2 | answer_accuracy |  | {"word": "ready"} |
| task-37 | 3 | answer_accuracy |  | {"word": "ready"} |
| task-38 | 2 | answer_accuracy |  | {"color": "blue"} |
| task-39 | 1 | answer_accuracy |  | {"number": 7} |
| task-39 | 2 | answer_accuracy |  | ```json {"number": 7} ``` |
| task-39 | 3 | answer_accuracy |  | {"number": 7} |
| task-40 | 1 | answer_accuracy |  | {"status": "paused"} |
| task-40 | 2 | answer_accuracy |  | status: paused |
| task-40 | 3 | answer_accuracy |  | {"status": "paused"} |

## Reproduction settings

```json
{
  "backend": "ollama",
  "base_url": "http://127.0.0.1:11439",
  "dataset_sha256": "72875e2b53317ce0d921849aaf5caa56f04cb0737ab1a6fcc4d02fdb68d33f03",
  "max_calls": 16,
  "max_turns": 8,
  "model": "qwen3:0.6b",
  "repeats": 3,
  "seed": 0,
  "temperature": 0.2,
  "think": false,
  "timeout_seconds": 30.0,
  "timestamp_utc": "2026-11-06T05:34:18.482560+00:00",
  "tools_sha256": "8bcbaf0006eac0f98dde0dd3218cb98c00a8cd5932c905b8222c3155e1a0c44a",
  "world_sha256": "bb8993e7e66c53dc2e8e2d3f929b43859acdd5561e47c5bca956ed59d085bbb0"
}
```

See runs.csv for every run and traces.json for tool arguments, results and messages.
