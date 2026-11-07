import json
import platform

import pytest
import torch

from llm_eval.data import prepare
from llm_eval.model import CompletionCollator, Config, encode_row


class Tokenizer:
    eos_token_id = 99

    def apply_chat_template(self, messages, **kwargs):
        return [1, 2, 3]

    def encode(self, text, **kwargs):
        return [4, 5]


def test_completion_mask_and_eos_survive_padding():
    row = {"id": "one", "input": "record", "target": {"name": "Fiction"}}
    encoded = encode_row(Tokenizer(), row, 10)
    assert encoded["labels"] == [-100, -100, -100, 4, 5, 99]
    shorter = {key: value[:-1] for key, value in encoded.items()}
    result = CompletionCollator(99)([encoded, shorter])
    assert result["labels"][0, -1] == 99  # Real EOS is supervised even when pad == EOS.
    assert result["labels"][1, -1] == -100
    assert result["attention_mask"][1, -1] == 0
    assert result["input_ids"].dtype == torch.int64


def test_never_silently_truncate_answers():
    with pytest.raises(ValueError, match="never truncate"):
        encode_row(Tokenizer(), {"id": "x", "input": "x", "target": {}}, 4)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"steps": 0},
        {"accumulation": 0},
        {"mode": "full"},
        {"precision": "fp16"},
        {"device": "mps"},
        {"learning_rate": -1},
    ],
)
def test_invalid_configuration(kwargs):
    with pytest.raises(ValueError):
        Config(**kwargs).validate()


@pytest.mark.integration
@pytest.mark.parametrize("mode", ["lora", "qlora"])
def test_real_training_and_reloaded_evaluation(tmp_path, mode):
    if mode == "qlora" and platform.system() == "Darwin":
        pytest.skip("Pinned bitsandbytes CPU backend is tested on Linux CI")
    from llm_eval.evaluate import evaluate
    from llm_eval.train import train

    data, run, tracking = tmp_path / "data", tmp_path / mode, tmp_path / "tracking"
    prepare(data, 8, 4, 4)
    config = Config(mode=mode, steps=2, batch_size=1, accumulation=2)
    meta = train(config, data, run, tracking)
    assert meta["adapter_before_sha256"] != meta["adapter_after_sha256"]
    assert 0 < meta["trainable_parameters"] < 1_000_000
    assert (run / "adapter/adapter_model.safetensors").stat().st_size > 1000
    assert (meta["four_bit_layers"] > 0) == (mode == "qlora")
    report = evaluate(
        data,
        [run],
        tmp_path / "report",
        limit=2,
        samples=100,
        tracking_dir=tracking,
        max_new_tokens=8,
    )
    assert report["n"] == 2
    assert set(report["runs"]) == (
        {"base", "base_nf4", "qlora"} if mode == "qlora" else {"base", "lora"}
    )
    assert (tmp_path / "report/failures.md").exists()
    assert len((tmp_path / "report/predictions.jsonl").read_text().splitlines()) >= 4
    changed = json.loads((data / "manifest.json").read_text())
    changed["seed"] = 99
    (data / "manifest.json").write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="different dataset"):
        evaluate(data, [run], tmp_path / "mismatched", tracking_dir=tracking)
