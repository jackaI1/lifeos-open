"""Graph generation and reference solvers. Vertex i is bit i of an integer."""
import networkx as nx
import numpy as np


def graph(n, seed, probability=0.5):
    if n < 2 or not 0 <= probability <= 1:
        raise ValueError("n must be at least 2 and probability must be in [0, 1]")
    return nx.fast_gnp_random_graph(n, probability, seed=seed)


def cut_value(g, assignment):
    return sum(((assignment >> u) ^ (assignment >> v)) & 1 for u, v in g.edges())


def exact(g):
    # Complement symmetry lets us fix the last bit to zero.
    n = len(g)
    states = np.arange(1 << (n - 1), dtype=np.uint64)
    values = np.zeros(len(states), dtype=np.int32)
    for u, v in g.edges():
        values += (((states >> u) ^ (states >> v)) & 1).astype(np.int32)
    i = int(np.argmax(values))
    return int(values[i]), int(states[i])


def greedy(g, seed, restarts=20):
    rng = np.random.default_rng(seed)
    best = (-1, 0)
    for _ in range(restarts):
        state = int(rng.integers(0, 1 << len(g)))
        value = cut_value(g, state)
        while True:
            candidates = [(cut_value(g, state ^ (1 << i)), i) for i in range(len(g))]
            new_value, vertex = max(candidates)
            if new_value <= value:
                break
            state ^= 1 << vertex
            value = new_value
        best = max(best, (value, state))
    return best
