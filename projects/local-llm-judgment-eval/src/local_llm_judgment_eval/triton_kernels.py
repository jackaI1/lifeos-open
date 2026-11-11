"""Triton kernel for kernels.fused_score. Imported only when Triton is installed.

One program handles one row. It loads the row once, computes the max, exponentials and sum in
registers, writes the softmax probabilities, and reduces the soft cross-entropy to one number.
Masked lanes (columns past the real choice count) never contribute to the max, sum or score.
"""

import triton
import triton.language as tl


@triton.jit
def _fused_score_kernel(
    logits_ptr,
    targets_ptr,
    probs_ptr,
    score_ptr,
    inv_temperature,
    n_cols,
    BLOCK: tl.constexpr,
):
    row = tl.program_id(0)
    offsets = tl.arange(0, BLOCK)
    mask = offsets < n_cols
    base = row * n_cols

    # Temperature scaling happens in the same pass that loads the row.
    x = tl.load(logits_ptr + base + offsets, mask=mask, other=float("-inf"))
    x = x.to(tl.float32) * inv_temperature
    row_max = tl.max(x, axis=0)
    shifted = x - row_max
    exps = tl.where(mask, tl.exp(shifted), 0.0)
    total = tl.sum(exps, axis=0)
    log_probs = shifted - tl.log(total)
    tl.store(probs_ptr + base + offsets, exps / total, mask=mask)

    targets = tl.load(targets_ptr + base + offsets, mask=mask, other=0.0).to(tl.float32)
    # tl.where keeps the masked -inf log-probabilities from turning into NaN.
    weighted = tl.where(mask, targets * log_probs, 0.0)
    tl.store(score_ptr + row, -tl.sum(weighted, axis=0))


def launch_fused_score(logits, targets, probs, score, inv_temperature: float) -> None:
    rows, cols = logits.shape
    if rows == 0:
        return
    block = 1 << max(cols - 1, 0).bit_length()
    _fused_score_kernel[(rows,)](
        logits,
        targets,
        probs,
        score,
        inv_temperature,
        cols,
        BLOCK=block,
    )
