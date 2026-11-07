# Experiment report

I ran 18 random graphs: 6, 8, 10, 12, 14 and 16 vertices, with seeds 1, 2 and 3 and edge probability 0.5. Each graph has an exact answer, a 20-restart greedy result, and QAOA runs at depths 1 and 2. Each QAOA optimizer had a budget of 12 COBYLA objective evaluations and a seeded starting point. Qiskit sampled its optimized circuits 512 times with and without noise. Raw observations and settings are in [results](../results/).

![Mean approximation ratios](../results/ratios.png)

The classical local search found the exact optimum on all 18 graphs in this sample. At depth 1, Qiskit's mean expected cut was 0.782 of optimum, and PennyLane's was 0.781. The clean sampled Qiskit mean was 0.782; with 1% depolarizing error on each compiled CX gate it was 0.769. These are averages over different graphs and finite sampling introduces variation. At depth 2, the Qiskit expectation averaged 0.751: more layers did not help under this small fixed optimization budget. Individual optimizer trajectories can differ slightly between frameworks because small numerical differences affect COBYLA's decisions; fixed-parameter expectations are checked in tests.

![Mean runtime](../results/runtime.png)

The timing plot uses a logarithmic scale and compares optimization wall time to classical solving time on this machine. It does not measure quantum hardware or isolate circuit execution. The sample is small, graphs are unweighted and randomly generated, and the simple noise model is not calibrated to a real device. The exact search grows exponentially, while statevector simulation needs memory exponential in vertex count. These results show no quantum advantage and should not be generalized to other graph families or tuned algorithms. The best measured cut in the CSV is separate from the expected cut used for the ratio plot.
