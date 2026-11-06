import itertools
import networkx as nx
import numpy as np
import pytest
from maxcut_benchmark.core import graph, cut_value, exact, greedy
from maxcut_benchmark.quantum import qiskit_expectation, pennylane_expectation, sample

@pytest.mark.parametrize('n,seed', [(3, 1), (5, 2), (7, 3)])
def test_exact_matches_independent_enumeration(n, seed):
    g = graph(n, seed)
    expected = max(sum(bits[u] != bits[v] for u, v in g.edges()) for bits in itertools.product([0, 1], repeat=n))
    value, assignment = exact(g)
    assert value == expected == cut_value(g, assignment)
    heuristic, state = greedy(g, seed)
    assert heuristic == cut_value(g, state) and heuristic <= value

@pytest.mark.parametrize('params', [[0.3, 0.4], [0.2, 0.7, 0.1, 0.5]])
def test_frameworks_agree(params):
    g = graph(5, 12)
    assert qiskit_expectation(g, np.array(params)) == pytest.approx(pennylane_expectation(g, np.array(params)), abs=1e-9)

def test_shots_track_statevector():
    g = nx.path_graph(4)
    params = np.array([0.4, 0.3])
    mean, best = sample(g, params, shots=4096, seed=7)
    assert mean == pytest.approx(qiskit_expectation(g, params), abs=0.08)
    assert mean <= best <= exact(g)[0]
