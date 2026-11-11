import pytest


@pytest.fixture(scope="session")
def tiny_model_dir(tmp_path_factory):
    """A randomly initialised two-layer Llama-style model with a character tokenizer.

    Nothing is downloaded. The model is only big enough to exercise the real code paths.
    """
    torch = pytest.importorskip("torch")
    pytest.importorskip("transformers")
    pytest.importorskip("tokenizers")
    from tokenizers import Regex, Tokenizer, decoders, models, pre_tokenizers
    from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast

    chars = [chr(c) for c in range(32, 127)]
    vocab = {"<unk>": 0, "<eos>": 1, "<pad>": 2}
    for ch in chars:
        vocab.setdefault(ch, len(vocab))
    tokenizer = Tokenizer(models.WordLevel(vocab, unk_token="<unk>"))
    tokenizer.pre_tokenizer = pre_tokenizers.Split(Regex("."), behavior="isolated")
    tokenizer.decoder = decoders.Fuse()
    fast = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="<unk>",
        eos_token="<eos>",
        pad_token="<pad>",
        chat_template=(
            "{% for m in messages %}{{ m['content'] }}{% endfor %}"
            "{% if add_generation_prompt %}{% endif %}"
        ),
    )
    path = tmp_path_factory.mktemp("tiny-model")
    fast.save_pretrained(path)
    torch.manual_seed(0)
    config = LlamaConfig(
        vocab_size=len(vocab),
        hidden_size=32,
        intermediate_size=64,
        num_hidden_layers=2,
        num_attention_heads=2,
        num_key_value_heads=2,
        max_position_embeddings=4096,
        eos_token_id=1,
        pad_token_id=2,
    )
    LlamaForCausalLM(config).save_pretrained(path)
    return str(path)
