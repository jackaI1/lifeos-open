# systolic-array-sim

I built a small simulator of an AI chip to learn how the underlying idea works. This is a learning project.

## Trying my own matrices

Inputs are signed 8-bit integers, numbers from -128 to 127. Results accumulate as signed 32-bit integers with wraparound on overflow. For floating-point data, `quantize` returns the integer values and a scale to convert the result back approximately.

```python
import numpy as np
from systolic_array.model import Config, quantize, simulate

a, scale_a = quantize([[0.5, -1.0, 0.25]])
b, scale_b = quantize([[1.0], [0.5], [-0.5]])
result = simulate(a, b, Config(rows=4, cols=4, tile_m=32))
approximate_float_result = result.output.astype(float) * scale_a * scale_b
print(approximate_float_result)
print(result.stats.total_cycles, result.stats.utilisation)

np.savez("inputs.npz", a=a, b=b)
```

```sh
python -m systolic_array matmul inputs.npz --output result.npy --tile 4
python -m systolic_array sweep --tiles 4 8 16 --tile-m 32 --bandwidth 8 --verify --json > report.json
```

`matmul` checks the integer result against NumPy before saving it. The JSON report includes total and streaming utilisation, data reuse, memory traffic, buffer size and energy-proxy counts. Without `--verify`, the sweep uses the faster analytical calculation and marks its results as unchecked.

## How I model the hardware

The array rows cover the shared dimension of the matrix multiplication; columns cover output columns. Each weight panel stays fixed while a block of input rows streams through. Local memory holds one input panel, one weight panel and one output tile. Partial results stay local across reduction panels, and each completed output is written to external memory once.

The roofline analysis is an optimistic speed limit: the smaller of the grid's arithmetic capacity and what memory bandwidth can supply. The actual schedule separately counts memory transfers, weight programming, and the time needed to fill and empty the grid. It serializes these phases, so it generally runs below that limit.

The energy proxy counts arithmetic, external bytes, local memory bytes and neighbour-link bytes. Its configurable relative costs help compare designs; they are not measured joules. I have not modelled leakage power, memory-bank conflicts, overlapping transfers or a specific chip. Convolution reports start after image patches have been arranged into a matrix. Attention reports cover matrix products, with scaling, softmax and requantisation prepared outside the timing model.

[The architecture notes](docs/architecture.md) explain the clock schedule, equations, quantisation and assumptions in detail.

## Tests and limits

There are 2 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `systolic-array-sim-ci.yml`.
