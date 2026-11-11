"""Scores a batch of typed model outputs against survey targets.

For each row of choice logits, the model's probabilities are a softmax of logits / temperature.
The score is the soft cross-entropy against the survey distribution, in nats:

    score = -sum_i target_i * log softmax(logits / T)_i

``reference_score`` is plain PyTorch and is the ground truth. ``fused_score`` runs a Triton
kernel that does the softmax, temperature scaling and log-probability scoring in one pass over
each row, and uses the reference path when CUDA is unavailable or Triton is not installed.
"""

import os


def _check(logits, targets, temperature):
    if logits.ndim != 2 or logits.shape != targets.shape:
        raise ValueError("logits and targets must be matching [batch, choices] tensors")
    if logits.shape[1] < 1:
        raise ValueError("at least one choice is required")
    if not temperature > 0:
        raise ValueError("temperature must be positive")


def reference_score(logits, targets, temperature: float = 1.0):
    """Plain PyTorch implementation. Returns (probs, score), both float32."""
    import torch

    _check(logits, targets, temperature)
    scaled = logits.float() / temperature
    probs = torch.softmax(scaled, dim=-1)
    log_probs = torch.log_softmax(scaled, dim=-1)
    score = -(targets.float() * log_probs).sum(dim=-1)
    return probs, score


def triton_available() -> bool:
    try:
        import triton  # noqa: F401
    except ImportError:
        return False
    return True


def _can_use_triton(logits) -> bool:
    if not triton_available():
        return False
    # TRITON_INTERPRET=1 runs the kernel on CPU tensors, which CI uses to test it without a GPU.
    return logits.is_cuda or os.environ.get("TRITON_INTERPRET") == "1"


def fused_score(logits, targets, temperature: float = 1.0, *, force_reference: bool = False):
    """Fused Triton path on CUDA, reference path otherwise. Returns (probs, score)."""
    import torch

    _check(logits, targets, temperature)
    if force_reference or not _can_use_triton(logits):
        return reference_score(logits, targets, temperature)

    from .triton_kernels import launch_fused_score

    rows, cols = logits.shape
    probs = torch.empty((rows, cols), dtype=torch.float32, device=logits.device)
    score = torch.empty((rows,), dtype=torch.float32, device=logits.device)
    launch_fused_score(
        logits.float().contiguous(),
        targets.float().contiguous(),
        probs,
        score,
        1.0 / temperature,
    )
    return probs, score
