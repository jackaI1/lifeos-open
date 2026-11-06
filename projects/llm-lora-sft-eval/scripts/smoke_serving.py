"""Real optimizer, reload, merge, HTTP inference and MLflow artifact assertions."""

import argparse
import json
from pathlib import Path

import torch
from mlflow import MlflowClient
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from llm_eval.data import prepare
from llm_eval.evaluate import evaluate
from llm_eval.export import export
from llm_eval.model import Config
from llm_eval.report import comparison_report
from llm_eval.serving import measure
from llm_eval.tracking import EXPERIMENT
from llm_eval.train import train


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["transformers", "vllm"], required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--steps", type=int, default=2)
    parser.add_argument("--train", type=int, default=8)
    parser.add_argument("--test", type=int, default=4)
    parser.add_argument("--max-tokens", type=int, default=16)
    args = parser.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=False)
    data, tracking = root / "data", root / "mlruns"
    prepare(data, args.train, 4, args.test)
    meta = train(
        Config(steps=args.steps, batch_size=1, accumulation=2), data, root / "lora", tracking
    )
    evaluate(
        data,
        [root / "lora"],
        root / "evaluation",
        limit=2,
        samples=100,
        tracking_dir=tracking,
        max_new_tokens=8,
    )
    exported = export(root / "lora", root / "export", tracking)
    assert exported["weights"]["base"] != exported["weights"]["merged"]
    # Check the export's numerical meaning, not only that a file was written.
    base = AutoModelForCausalLM.from_pretrained(root / "export/base")
    adapter = PeftModel.from_pretrained(base, str(root / "lora/adapter")).eval()
    merged = AutoModelForCausalLM.from_pretrained(root / "export/merged").eval()
    tokenizer = AutoTokenizer.from_pretrained(root / "export/base")
    inputs = tokenizer("Extract a fictional member record", return_tensors="pt")
    with torch.inference_mode():
        torch.testing.assert_close(
            adapter(**inputs).logits, merged(**inputs).logits, atol=1e-4, rtol=1e-4
        )
    del adapter, base, merged
    for variant in ("base", "merged"):
        result = measure(
            root / "export",
            variant,
            data,
            root / variant,
            backend=args.backend,
            limit=args.test,
            max_tokens=args.max_tokens,
            tracking_dir=tracking,
        )
        assert (
            result["metrics"]["requests"] == result["metrics"]["successful_requests"] == args.test
        )
        assert result["metrics"]["output_tokens_per_s"] > 0
        assert result["training_run_id"] == meta["mlflow_run_id"]
        resource = json.loads((root / variant / "resource.json").read_text())
        assert resource["port_closed"]
        if args.backend == "vllm":
            assert resource["container_removed"]
    summary = comparison_report(root / "comparison", tracking)
    assert summary["runs"] == 5
    assert summary["serving_cohorts"] == 1
    client = MlflowClient()
    runs = client.search_runs([client.get_experiment_by_name(EXPERIMENT).experiment_id])
    assert len(runs) == 5 and all(r.info.status == "FINISHED" for r in runs)
    for run in runs:
        assert run.data.params
        assert client.list_artifacts(run.info.run_id)
        if run.data.tags["kind"] in ("training", "evaluation", "serving-evaluation"):
            assert run.data.metrics
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
