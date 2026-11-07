"""QAOA implementations using the same cost and mixer conventions."""
import numpy as np
import pennylane as qml
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error
from scipy.optimize import minimize
from .core import cut_value


def circuit(g, params):
    n = len(g)
    p = len(params) // 2
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for gamma, beta in zip(params[:p], params[p:]):
        for u, v in g.edges():
            # exp(-i gamma C): C=(1-ZZ)/2, up to a global phase.
            qc.rzz(-gamma, u, v)
        for i in range(n):
            qc.rx(2 * beta, i)
    return qc


def scores(g, reverse=False):
    n = len(g)
    states = np.arange(1 << n, dtype=np.uint64)
    values = np.zeros(len(states))
    for u, v in g.edges():
        if reverse:
            u, v = n - 1 - u, n - 1 - v
        values += ((states >> u) ^ (states >> v)) & 1
    return values


def qiskit_expectation(g, params):
    probabilities = Statevector.from_instruction(circuit(g, params)).probabilities()
    return float(np.dot(probabilities, scores(g)))


def pennylane_expectation(g, params):
    n = len(g)
    p = len(params) // 2
    dev = qml.device("default.qubit", wires=n)
    @qml.qnode(dev)
    def run():
        for i in range(n):
            qml.Hadamard(wires=i)
        for gamma, beta in zip(params[:p], params[p:]):
            for u, v in g.edges():
                qml.IsingZZ(-gamma, wires=[u, v])
            for i in range(n):
                qml.RX(2 * beta, wires=i)
        return qml.probs(wires=range(n))
    # PennyLane orders wire 0 as the most significant bit.
    probabilities = run()
    return float(np.dot(probabilities, scores(g, reverse=True)))


def sample(g, params, shots=1024, seed=0, noise=0.0):
    qc = circuit(g, params)
    qc.measure_all()
    model = None
    if noise:
        model = NoiseModel()
        model.add_all_qubit_quantum_error(depolarizing_error(noise, 2), ['cx'])
    simulator = AerSimulator(noise_model=model)
    compiled = transpile(qc, simulator, basis_gates=['h', 'rx', 'rz', 'cx'], seed_transpiler=seed)
    counts = simulator.run(compiled, shots=shots, seed_simulator=seed).result().get_counts()
    values = [(cut_value(g, int(bits.replace(' ', ''), 2)), count) for bits, count in counts.items()]
    return sum(v * count for v, count in values) / shots, max(v for v, _ in values)


def optimize(g, backend, p, maxiter, seed):
    if p < 1 or maxiter < 1:
        raise ValueError('p and maxiter must be positive')
    fn = {'qiskit': qiskit_expectation, 'pennylane': pennylane_expectation}[backend]
    rng = np.random.default_rng(seed)
    initial = np.r_[rng.uniform(0, np.pi, p), rng.uniform(0, np.pi / 2, p)]
    result = minimize(lambda x: -fn(g, x), initial, method='COBYLA', options={'maxiter': maxiter})
    return result.x, -float(result.fun), result.nfev
