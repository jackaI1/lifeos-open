"""Small reproducible convolution and single-head attention GEMM workloads."""

from dataclasses import dataclass

import numpy as np

from .model import quantize


@dataclass(frozen=True)
class Workload:
    name: str
    a: np.ndarray
    b: np.ndarray
    description: str


def lower_conv2d(image, kernels, *, stride=1, padding=0):
    """NHWC int8 image and [KH,KW,Cin,Cout] filters to im2col GEMM.

    im2col means flattening each image patch into one matrix row. The report
    measures this lowered matrix's traffic; CPU lowering costs are excluded.
    """
    image, kernels = np.asarray(image), np.asarray(kernels)
    if image.ndim != 4 or kernels.ndim != 4 or image.shape[3] != kernels.shape[2]:
        raise ValueError(
            "expected NHWC image and KH,KW,Cin,Cout kernels with matching channels"
        )
    if image.dtype != np.int8 or kernels.dtype != np.int8:
        raise TypeError("convolution inputs must be int8")
    if (
        type(stride) is not int
        or stride <= 0
        or type(padding) is not int
        or padding < 0
    ):
        raise ValueError("stride must be positive and padding nonnegative integers")
    if any(d <= 0 for d in image.shape + kernels.shape):
        raise ValueError("convolution dimensions must be positive")
    batch, height, width, _ = image.shape
    kh, kw, cin, cout = kernels.shape
    oh, ow = (
        (height + 2 * padding - kh) // stride + 1,
        (width + 2 * padding - kw) // stride + 1,
    )
    if oh <= 0 or ow <= 0:
        raise ValueError("kernel does not fit padded image")
    padded = np.pad(image, ((0, 0), (padding, padding), (padding, padding), (0, 0)))
    patches = np.empty((batch * oh * ow, kh * kw * cin), dtype=np.int8)
    row = 0
    for bi in range(batch):
        for y in range(oh):
            for x in range(ow):
                patches[row] = padded[
                    bi, y * stride : y * stride + kh, x * stride : x * stride + kw
                ].reshape(-1)
                row += 1
    return patches, kernels.reshape(kh * kw * cin, cout), (batch, oh, ow, cout)


def example_workloads(seed=7):
    rng = np.random.default_rng(seed)

    def ints(shape):
        return rng.integers(-128, 128, shape, dtype=np.int8)

    conv_a, conv_b, _ = lower_conv2d(ints((1, 8, 8, 8)), ints((3, 3, 8, 16)), padding=1)
    point_a, point_b, _ = lower_conv2d(ints((1, 8, 8, 16)), ints((1, 1, 16, 32)))
    queries, keys, values = ints((64, 32)), ints((64, 32)), ints((64, 32))
    # Fixture preparation on the host, outside the accelerator timing model.
    # Q and K represent real values at scale 1/128; probabilities have zero point 0.
    scores = (queries.astype(np.int32) @ keys.astype(np.int32).T).astype(np.float64) / (
        128**2 * np.sqrt(32)
    )
    exponentials = np.exp(scores - scores.max(axis=1, keepdims=True))
    probabilities, _ = quantize(exponentials / exponentials.sum(axis=1, keepdims=True))
    return [
        Workload(
            "conv3x3",
            conv_a,
            conv_b,
            "8x8 image, 8 input / 16 output channels, padded 3x3 filter",
        ),
        Workload(
            "conv1x1",
            point_a,
            point_b,
            "8x8 image, 16 input / 32 output channels, 1x1 filter",
        ),
        Workload(
            "attention-scores",
            queries,
            keys.T,
            "Q times K-transpose, 64 tokens, head width 32",
        ),
        Workload(
            "attention-values",
            probabilities,
            values,
            "requantized attention probabilities times V; softmax excluded",
        ),
        Workload(
            "decode-scores", queries[:1], keys.T, "one query against 64 cached keys"
        ),
    ]
