import pytest

from local_llm_judgment_eval.training import encode_example, load_training_examples


class TinyTokenizer:
    """Only tokenization is stubbed; masking and validation use production code."""

    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        text = "".join(f"<{m['role']}>{m['content']}" for m in messages)
        if add_generation_prompt:
            text += "<assistant>"
        return list(text.encode())


def test_training_masks_the_whole_prompt_but_keeps_response_tokens():
    example = encode_example(TinyTokenizer(), "Count tokens", '{"A":1,"B":0,"C":0,"D":0}')
    prefix_length = len("<user>Count tokens<assistant>")
    assert all(x == -100 for x in example["labels"][:prefix_length])
    assert example["labels"][prefix_length:] == example["input_ids"][prefix_length:]
    assert len(example["input_ids"]) == len(example["labels"])
    assert len(example["labels"][prefix_length:]) > 0


def test_training_refuses_silent_truncation():
    with pytest.raises(ValueError, match="length"):
        encode_example(TinyTokenizer(), "x" * 100, '{"A":1,"B":0,"C":0,"D":0}', max_length=8)


def test_formatting_examples_are_valid_and_not_survey_targets():
    examples = load_training_examples()
    assert len(examples) == 24
    assert all("tokens in a bag" in row["prompt"] for row in examples)
    assert all(
        "AI" not in row["prompt"] and "United States" not in row["prompt"] for row in examples
    )
