"""Non-streaming OpenAI completions benchmark; counts server tokens, not words."""

import json
import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from llm_eval.metrics import score_row


def completion(base_url, model, prompt, max_tokens, timeout=120):
    request = urllib.request.Request(
        base_url.rstrip("/") + "/completions",
        data=json.dumps(
            {
                "model": model,
                "prompt": prompt,
                "max_tokens": max_tokens,
                "temperature": 0,
                "seed": 42,
                "stream": False,
                "add_special_tokens": False,
            }
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = json.load(response)
    elapsed = time.perf_counter() - start
    text = result["choices"][0]["text"]
    tokens = result["usage"]["completion_tokens"]
    if not isinstance(text, str) or type(tokens) is not int or tokens < 1:
        raise ValueError("Server must return text and a positive integer completion_tokens")
    return {"prediction": text, "completion_tokens": tokens, "latency_s": elapsed}


def aggregate(records, elapsed):
    if not records or elapsed <= 0 or not math.isfinite(elapsed):
        raise ValueError("Require nonempty records and positive finite elapsed time")
    successful = [r for r in records if r.get("error") is None]
    latency = [r["latency_s"] for r in successful]
    return {
        "requests": len(records),
        "successful_requests": len(successful),
        "failed_requests": len(records) - len(successful),
        "success_rate": len(successful) / len(records),
        "elapsed_s": elapsed,
        "output_tokens": sum(r["completion_tokens"] for r in successful),
        "output_tokens_per_s": sum(r["completion_tokens"] for r in successful) / elapsed,
        "requests_per_s": len(successful) / elapsed,
        **(
            {f"latency_p{q}_s": float(np.percentile(latency, q)) for q in (50, 95)}
            if latency
            else {}
        ),
        **{
            key: sum(r["scores"][key] for r in records) / len(records)
            for key in records[0]["scores"]
        },
    }


def benchmark(base_url, model, rows, prompts, max_tokens=96, concurrency=1, warmup=1, timeout=120):
    if (
        not rows
        or len(rows) != len(prompts)
        or max_tokens < 1
        or concurrency < 1
        or warmup < 0
        or timeout <= 0
    ):
        raise ValueError("Invalid benchmark sizes, generation budget or timeout")
    # Warmups must succeed and are excluded from both scores and timing.
    for _ in range(warmup):
        completion(base_url, model, prompts[0], max_tokens, timeout)

    def request(pair):
        row, prompt = pair
        record = {"id": row["id"], "target": row["target"]}
        try:
            record.update(completion(base_url, model, prompt, max_tokens, timeout))
        except Exception as error:
            record.update(
                prediction="", completion_tokens=0, error=f"{type(error).__name__}: {error}"
            )
        record["scores"] = score_row(record["prediction"], row["target"])
        return record

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        records = list(pool.map(request, zip(rows, prompts, strict=True)))
    return aggregate(records, time.perf_counter() - start), records
