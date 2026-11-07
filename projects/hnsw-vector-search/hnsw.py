"""A small, persistent HNSW index using squared Euclidean distance."""
import heapq
import json
import math
import random


def distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def exact(vectors, query, k=10):
    """Return (id, squared distance), ordered by distance then id."""
    return sorted(((i, distance(v, query)) for i, v in enumerate(vectors)), key=lambda p: (p[1], p[0]))[:k]


class HNSW:
    def __init__(self, dimensions, m=12, ef_construction=80, seed=42):
        if dimensions < 1 or m < 2 or ef_construction < m:
            raise ValueError('dimensions >= 1, m >= 2 and ef_construction >= m required')
        self.dimensions, self.m, self.ef_construction = dimensions, m, ef_construction
        self.vectors, self.graph, self.entry, self.max_level = [], [], None, -1
        self.rng = random.Random(seed)

    def _vector(self, vector):
        v = [float(x) for x in vector]
        if len(v) != self.dimensions or not all(math.isfinite(x) for x in v):
            raise ValueError('vector must have the configured dimensions and finite values')
        return v

    def _layer(self, q, entries, ef, level):
        seen = set(entries)
        candidates = [(distance(q, self.vectors[i]), i) for i in entries]
        heapq.heapify(candidates)
        best = [(-d, -i) for d, i in candidates]
        heapq.heapify(best)
        while candidates:
            d, node = heapq.heappop(candidates)
            if len(best) >= ef and d > -best[0][0]:
                break
            for neighbor in self.graph[node][level]:
                if neighbor in seen:
                    continue
                seen.add(neighbor)
                nd = distance(q, self.vectors[neighbor])
                if len(best) < ef or (nd, neighbor) < (-best[0][0], -best[0][1]):
                    heapq.heappush(candidates, (nd, neighbor))
                    heapq.heappush(best, (-nd, -neighbor))
                    if len(best) > ef:
                        heapq.heappop(best)
        return sorted((-d, -i) for d, i in best)

    def insert(self, vector):
        v = self._vector(vector)
        level = min(32, int(-math.log(max(self.rng.random(), 1e-15)) / math.log(self.m)))
        node = len(self.vectors)
        self.vectors.append(v)
        self.graph.append([[] for _ in range(level + 1)])
        if self.entry is None:
            self.entry, self.max_level = node, level
            return node
        ep = self.entry
        for layer in range(self.max_level, level, -1):
            ep = self._layer(v, [ep], 1, layer)[0][1]
        for layer in range(min(level, self.max_level), -1, -1):
            found = self._layer(v, [ep], self.ef_construction, layer)
            limit = self.m * 2 if layer == 0 else self.m
            neighbors = [i for _, i in found[:limit]]
            self.graph[node][layer] = neighbors
            for neighbor in neighbors:
                links = self.graph[neighbor][layer]
                links.append(node)
                links.sort(key=lambda i: (distance(self.vectors[neighbor], self.vectors[i]), i))
                del links[limit:]
            ep = found[0][1]
        if level > self.max_level:
            self.entry, self.max_level = node, level
        return node

    def search(self, vector, k=10, ef_search=50):
        q = self._vector(vector)
        if k < 1 or ef_search < k:
            raise ValueError('k must be positive and ef_search must be at least k')
        if self.entry is None:
            return []
        ep = self.entry
        for layer in range(self.max_level, 0, -1):
            ep = self._layer(q, [ep], 1, layer)[0][1]
        return [(i, d) for d, i in self._layer(q, [ep], ef_search, 0)[:k]]

    def save(self, path):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'version': 1, 'dimensions': self.dimensions, 'm': self.m,
                       'ef_construction': self.ef_construction, 'vectors': self.vectors,
                       'graph': self.graph, 'entry': self.entry, 'max_level': self.max_level,
                       'rng_state': self.rng.getstate()}, f, allow_nan=False)

    @classmethod
    def load(cls, path):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        if data['version'] != 1:
            raise ValueError('unsupported index version')
        index = cls(data['dimensions'], data['m'], data['ef_construction'])
        index.vectors, index.graph = data['vectors'], data['graph']
        index.entry, index.max_level = data['entry'], data['max_level']
        state = data['rng_state']
        index.rng.setstate((state[0], tuple(state[1]), state[2]))
        return index
