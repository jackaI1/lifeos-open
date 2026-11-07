"""Command-line entry point. Report generation succeeds independently of model score."""

import argparse
import hashlib
import math
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path

from .dataset import load_tasks
from .models import OllamaModel, ScriptedModel
from .reports import percent, write_reports
from .runner import canonical, evaluate
from .tools import DECLARATIONS


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=("ollama", "scripted"), default="ollama")
    parser.add_argument("--model", default="qwen3:0.6b")
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument("--scripted-profile", choices=("perfect", "mixed"), default="perfect")
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--max-turns", type=int, default=8)
    parser.add_argument("--max-calls", type=int, default=16)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--no-think", action="store_true", help="request Ollama think=false")
    parser.add_argument("--out", type=Path, default=Path("reports/latest"))
    parser.add_argument(
        "--fail-under",
        type=float,
        default=0,
        help="exit 1 if the all-checks pass rate is below this fraction (0 to 1)",
    )
    args = parser.parse_args(argv)
    try:
        if min(args.repeats, args.max_turns, args.max_calls) < 1:
            raise ValueError("repeat and call/turn budgets must be positive")
        if not math.isfinite(args.fail_under) or not 0 <= args.fail_under <= 1:
            raise ValueError("fail-under must be between 0 and 1")
        # Validate shared settings even for scripted runs to catch misconfigured commands.
        adapter = OllamaModel(
            args.base_url,
            args.model,
            timeout=args.timeout,
            temperature=args.temperature,
            think=False if args.no_think else None,
        )
        tasks = load_tasks(args.dataset)
    except ValueError as exc:
        parser.error(str(exc))
    model = adapter if args.backend == "ollama" else ScriptedModel(tasks, args.scripted_profile)
    report = evaluate(
        tasks,
        model,
        repeats=args.repeats,
        seed=args.seed,
        max_turns=args.max_turns,
        max_calls=args.max_calls,
    )
    report["metadata"].update(
        {
            "backend": args.backend,
            "model": args.model
            if args.backend == "ollama"
            else "oracle fixture (" + args.scripted_profile + "), not an LLM",
            "base_url": args.base_url if args.backend == "ollama" else None,
            "temperature": args.temperature,
            "think": False if args.no_think else None,
            "timeout_seconds": args.timeout,
            "timestamp_utc": datetime.now(UTC).isoformat(),
            "world_sha256": hashlib.sha256(
                files("agent_tool_eval").joinpath("data/world.json").read_bytes()
            ).hexdigest(),
            "tools_sha256": hashlib.sha256(canonical(DECLARATIONS).encode()).hexdigest(),
        }
    )
    write_reports(report, args.out)
    print(
        f"{report['summary']['runs']} runs: pass rate {percent(report['summary']['pass_rate'])}; "
        f"consistency {percent(report['summary']['consistency'])}. Report: {args.out / 'report.md'}"
    )
    return int(report["summary"]["pass_rate"] < args.fail_under)
