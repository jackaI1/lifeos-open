# Model and assumptions

I use an abstract weight-stationary array to separate three questions: is the integer answer correct, how long does the chosen schedule take, and what limits its speed? Cycle accuracy here means exact register updates for the architecture below. It does not mean a timing model calibrated to a physical TPU.

## Mapping and clock boundaries

For `A[M,K] B[K,N] = C[M,N]`, an R-row, C-column array holds a weight panel `B[h,w]`, where `h <= R` and `w <= C`. A processing element (PE) is one cell with an int8 weight register, an activation register and an int32 partial-sum register. Every active PE can perform one multiply-accumulate (MAC) per clock.

For input tile row `i`, activation `A[i,r]` enters the left of row `r` on stream clock `i+r`. It reaches column `c` on clock `i+r+c`. The partial sum from row `r-1` reaches that same cell on that clock. A zero partial sum enters the top boundary. Tags accompany values so a bubble, an empty pipeline slot, cannot accidentally become a MAC. A numerical zero remains real work; there is no sparsity skipping.

Every tick reads the previous clock's neighbour registers, computes, and replaces the registers simultaneously. No same-clock multi-hop propagation is allowed. The output of input row `i`, column `c` emerges from active row `h-1` on stream clock `i+h-1+c`. A panel of `t` input rows therefore takes `t+h+w-2` streaming clocks. Inactive edge rows and columns are bypassed; unused physical cells still count in the utilisation denominator. This requires configurable edge routing rather than fixed full-array drain latency.

For the 2×2 demo, streaming clock 0 uses one PE, clocks 1 and 2 use three each, and clock 3 uses one. Four streaming clocks perform eight MACs. Two weight-programming clocks and three external-transfer clocks bring the total to nine.

`simulate(..., trace=True)` records each clock's phase, global tile offsets, weight-register updates, individual MACs and panel outputs. Output coordinates in a trace are local to that tile; outputs are partial sums for its K panel. Weight updates happen only in programming phases. Traces stop with an error at 10,000 clocks by default or 1,000,000 MAC events, preventing accidental retention of a large trace. Normal simulations retain no trace.

## Tiling, storage and traffic

The loop order is output-column tile, input-row tile, reduction panel (`N, M, K`). Weights are stationary during one input-row tile, then can be reloaded for the next one. An int32 accumulator tile remains resident across all K panels. External partial-sum spills are unnecessary.

The local SRAM budget is `tile_m*R + R*C + 4*tile_m*C` bytes, for input, weight and accumulator buffers. This is provisioned capacity; edge tiles use less. The model does not silently assume an unbounded cache or retain the entire output on chip. The returned host array is not part of the hardware buffer budget.

Each panel follows these serialized phases:

1. Read `h*w` weight bytes from external memory into local SRAM.
2. Program one row of `w` weight registers per clock, taking `h` clocks. A dedicated programming bus supports up to C bytes per clock.
3. Read `t*h` input bytes into local SRAM.
4. Stream inputs for `t+h+w-2` clocks; store every emitted panel result into the accumulator tile with an int32 addition.
5. After all K panels, write the completed output tile's `4*t*w` bytes to external memory.

Each external transfer takes `ceil(bytes / bandwidth)` clocks, rounded individually. The ceiling uses the exact integer ratio of the configured floating-point bandwidth, avoiding overflow for extremely small values. `bandwidth` is aggregate bytes per clock shared between reads and writes. There is no overlap, startup penalty, cache, burst alignment, latency hiding or double buffering. Local SRAM is ideally banked to supply up to R activations per clock, program C weights per clock, and receive up to C outputs per clock. This local bandwidth is assumed sufficient; the CLI bandwidth parameter applies only to external memory.

Let `bm=ceil(M/tile_m)`, `bk=ceil(K/R)` and `bn=ceil(N/C)`. For positive dimensions:

| Quantity | Count |
| --- | --- |
| MACs | `M*K*N` |
| Streaming clocks | `bn*bk*M + bm*bn*K + bm*bk*N - 2*bm*bn*bk` |
| Weight-programming clocks | `bm*bn*K` |
| Input DRAM bytes | `M*K*bn` |
| Weight DRAM bytes | `K*N*bm` |
| Output DRAM bytes | `4*M*N` |
| Activation neighbour hops | `M*K*(N-bn)` |
| Partial-sum neighbour hops | `M*N*(K-bk)` |
| Accumulator updates | `M*N*bk` |

`analysis.py` calculates these independently of the register simulation. Tests compare its counts with actual events on ragged shapes, fractional external bandwidth and multiple tile geometries. `--verify` compares all raw counters as well as matrix answers. If any dimension is zero, the API returns host-created zero outputs with zero hardware work; it does not model an accelerator zero-fill command.

## Roofline, reuse and energy

One MAC is two integer operations, one multiply and one add. Intensity `I = 2*MACs / DRAM_bytes` is operations per external byte. Peak throughput is `2*R*C` operations per clock. The roofline ceiling is `min(peak, bandwidth*I)`. The `roofline_bound` field labels whichever ceiling is lower; it is not a claim that memory is the only reason the simulated schedule is slow. Equal ceilings are labelled compute. Empty work has a zero ceiling.

Achieved throughput is `2*MACs / total_clocks`. Total utilisation is `MACs / (R*C*total_clocks)`. Streaming utilisation uses only streaming clocks, exposing pipeline and edge losses separately from DMA and programming overhead. The roofline assumes perfect overlap while the executed schedule serializes phases, so the ceiling is a bound rather than a prediction.

Activation reuse is MACs divided by externally loaded activation bytes; weight reuse is MACs divided by externally loaded weight bytes. Each byte is one int8 value. Padding zeros from convolution count as transferred inputs and MACs. No layer-to-layer cache or fusion is assumed.

The energy-proxy event counts are:

- MACs executed, including multiplication by zero.
- DRAM bytes read and written.
- SRAM bytes: twice the loaded input and weight bytes (DMA write plus array-feed read), eight bytes per accumulator update (int32 read and write), and four bytes per final output (DMA read).
- Link bytes: one per activation hop and four per partial-sum hop.

The default score is `MACs + 200*DRAM_bytes + 6*SRAM_bytes + link_bytes`. These coefficients are deliberately illustrative, not measurements or a quoted semiconductor energy table. `EnergyCosts` lets me change them in Python. Register access, accumulator addition energy outside the MACs, host preprocessing, control, clock distribution, leakage, voltage, frequency and physical wire lengths are excluded. The score supports sensitivity studies, not battery-life or power claims.

## Integer arithmetic and layer examples

Both operands must already be `np.int8`. Partial sums and accumulated output tiles wrap modulo 2^32 with a signed two's-complement interpretation. The implementation uses int64 intermediates and explicitly wraps every partial sum and accumulator update. The NumPy oracle widens inputs to int32 before `@`; multiplying int8 arrays directly would produce the wrong reference dtype.

`quantize` uses a symmetric per-tensor scale `max(abs(x))/127`, clamped to the smallest positive float64 for subnormal inputs, zero point zero, nearest-even rounding and clipping to [-127,127]. All-zero and empty tensors use scale 1. A product can be dequantised by multiplying its int32 result by both input scales, provided overflow has not occurred. Arbitrary asymmetric zero points, per-channel scales, bias, activation functions and output requantisation hardware are outside this model.

`lower_conv2d` accepts NHWC images and `[KH,KW,Cin,Cout]` filters, supports integer stride and symmetric zero padding, and flattens each patch into a row. Convolution fixtures are 8×8 images: a padded 3×3 layer with 8 input and 16 output channels (`64,72,16`), and a 1×1 layer with 16 input and 32 output channels (`64,16,32`). Lowered activation traffic includes repeated patch values; host patch extraction and its memory cost are excluded. A direct spatial-sum test independently checks this mapping.

Attention fixtures use 64 tokens and a head width of 32: scores `Q @ K.T` (`64,32,64`), quantised probabilities times V (`64,64,32`), and one decode query against cached keys (`1,32,64`). Seeded synthetic Q and K represent values at scale 1/128. Host code scales their dot products by sqrt(32), runs stable softmax, and quantises probabilities before the values example. Those host operations have no modeled clocks or energy. These are individual single-head matrix products, not an end-to-end transformer or a trained-network accuracy benchmark.

## Background

The [original TPU evaluation by Jouppi and colleagues](https://arxiv.org/abs/1704.04760) provides background on int8 matrix acceleration and software-managed local memory. My dimensions, storage, bus assumptions and schedule are my own simplified architecture, not a reproduction of that chip. The [Roofline report by Williams, Waterman and Patterson](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2008/EECS-2008-134.pdf) defines the relationship between operations, external-memory traffic and bandwidth; I apply that bound to integer operations here.
