"""Ollama native chat adapter and an explicitly oracle-backed regression fixture."""

import json
import math
import os
from copy import deepcopy
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from .runner import ModelError


class OllamaModel:
    def __init__(self, base_url, model, *, timeout=30, temperature=0.2, think=None):
        url = urlsplit(base_url)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError("base URL must be HTTP(S) without credentials, query or fragment")
        if not model or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("model and positive finite timeout are required")
        if not math.isfinite(temperature) or not 0 <= temperature <= 2:
            raise ValueError("temperature must be between 0 and 2")
        self.url = base_url.rstrip("/") + "/api/chat"
        self.model, self.timeout, self.temperature = model, timeout, temperature
        self.think = think

    def respond(self, messages, tools, seed):
        payload = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": False,
            "options": {"seed": seed, "temperature": self.temperature, "num_predict": 512},
        }
        if self.think is not None:
            payload["think"] = self.think
        headers = {"Content-Type": "application/json"}
        if token := os.environ.get("AGENT_EVAL_API_KEY"):
            headers["Authorization"] = "Bearer " + token
        request = Request(self.url, data=json.dumps(payload).encode(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read(1_048_577)
                if len(raw) > 1_048_576:
                    raise ModelError("malformed_response", "response exceeds 1 MiB limit")
        except (HTTPError, URLError, TimeoutError, OSError, HTTPException) as exc:
            # Do not include server bodies, URLs, headers or credentials in diagnostics.
            raise ModelError("endpoint_error", "model endpoint request failed") from exc
        try:
            result = json.loads(raw)
            if isinstance(result, dict) and result.get("error"):
                raise ModelError("endpoint_error", "model endpoint returned an error")
            message = result.get("message") if isinstance(result, dict) else None
            if not isinstance(message, dict):
                raise ModelError("malformed_response", "response has no assistant message object")
            return message
        except (ValueError, UnicodeDecodeError, RecursionError) as exc:
            raise ModelError("malformed_response", "response is not valid JSON") from exc


class ScriptedModel:
    """Known-answer fixture, NOT an LLM or evidence of model capability.

    Perfect replays references. Mixed injects faults on repeat seeds divisible by 3
    for the first five tasks, to exercise report diagnosis and consistency.
    """

    def __init__(self, tasks, profile="perfect"):
        if profile not in ("perfect", "mixed"):
            raise ValueError("unknown scripted profile")
        self.tasks = {task["prompt"]: (index, task) for index, task in enumerate(tasks)}
        self.profile = profile

    def respond(self, messages, tools, seed):
        prompt = next(m["content"] for m in messages if m["role"] == "user")
        index, task = self.tasks[prompt]
        step = sum(m["role"] == "assistant" for m in messages)
        expected = task["expected_calls"]
        faulty = self.profile == "mixed" and seed % 3 == 0 and index < 5
        if step < len(expected):
            call = deepcopy(expected[step])
            if faulty and step == 0:
                if index == 0:
                    call = {"name": "ticket_get", "arguments": {"id": "T-101"}}
                elif index == 1:
                    call["arguments"] = {"expression": 42}
                elif index == 2:
                    call["arguments"] = {"expression": "1 + 1"}
                elif index == 4:
                    return {"role": "assistant", "content": "", "tool_calls": [None]}
            return {"role": "assistant", "content": "", "tool_calls": [{"function": call}]}
        value = "incorrect" if faulty and index == 3 else task["answer"]["value"]
        return {"role": "assistant", "content": json.dumps(value)}
