"""Load references separately from the messages sent to a model."""

import json
from importlib.resources import files
from pathlib import Path

from jsonschema import Draft202012Validator

from .tools import validate_arguments

TASK_SCHEMA = {
    "type": "array",
    "minItems": 1,
    "maxItems": 10000,
    "items": {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "category", "prompt", "expected_calls", "answer"],
        "properties": {
            "id": {"type": "string", "minLength": 1, "maxLength": 80},
            "category": {"type": "string", "minLength": 1},
            "prompt": {"type": "string", "minLength": 1},
            "expected_calls": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "arguments"],
                    "additionalProperties": False,
                    "properties": {"name": {"type": "string"}, "arguments": {"type": "object"}},
                },
            },
            "answer": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "value"],
                "properties": {"kind": {"enum": ["number", "text", "json"]}, "value": {}},
            },
        },
    },
}


def load_tasks(path=None):
    try:
        content = (
            Path(path).read_text()
            if path
            else files("agent_tool_eval").joinpath("data/tasks.json").read_text()
        )
        tasks = json.loads(content)
        Draft202012Validator(TASK_SCHEMA).validate(tasks)
        if len({t["id"] for t in tasks}) != len(tasks):
            raise ValueError("duplicate IDs")
        for task in tasks:
            for call in task["expected_calls"]:
                validate_arguments(call["name"], call["arguments"])
            answer = task["answer"]
            if answer["kind"] == "number" and type(answer["value"]) not in (int, float):
                raise ValueError("number answer must be numeric")
            if answer["kind"] == "text" and not isinstance(answer["value"], str):
                raise ValueError("text answer must be a string")
        # Also reject non-finite JSON numbers, including Python's permissive NaN decoding.
        json.dumps(tasks, allow_nan=False)
        return tasks
    except (ValueError, OSError) as exc:
        raise ValueError("invalid dataset: " + str(exc)[:160]) from exc
    except Exception as exc:
        # jsonschema errors include entire instance values; keep CLI diagnostics bounded.
        raise ValueError("invalid dataset: schema validation failed") from exc
