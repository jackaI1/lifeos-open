import os
import random
import tempfile
import unittest
from hnsw import HNSW, exact


class IndexTests(unittest.TestCase):
    def test_graph_and_persistence(self):
        rng = random.Random(2)
        index = HNSW(4, m=4, ef_construction=30)
        for _ in range(120):
            index.insert([rng.random() for _ in range(4)])
        self.assertEqual(index.max_level, len(index.graph[index.entry]) - 1)
        for node, layers in enumerate(index.graph):
            for level, links in enumerate(layers):
                self.assertLessEqual(len(links), 8 if level == 0 else 4)
                self.assertEqual(len(links), len(set(links)))
                self.assertNotIn(node, links)
                for neighbor in links:
                    self.assertLess(level, len(index.graph[neighbor]))
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'index.json')
            index.save(path)
            restored = HNSW.load(path)
            self.assertEqual(index.search([0.1] * 4), restored.search([0.1] * 4))
            self.assertEqual(index.insert([0.2] * 4), restored.insert([0.2] * 4))
            self.assertEqual(index.graph, restored.graph)

    def test_recall(self):
        rng = random.Random(8)
        base = [[rng.random() for _ in range(8)] for _ in range(400)]
        queries = [[rng.random() for _ in range(8)] for _ in range(40)]
        index = HNSW(8, m=8, ef_construction=60)
        for v in base:
            index.insert(v)
        recall = sum(len({i for i, _ in exact(base, q)} & {i for i, _ in index.search(q, 10, 40)}) / 10 for q in queries) / len(queries)
        self.assertGreaterEqual(recall, 0.95)

    def test_validation(self):
        index = HNSW(2)
        self.assertEqual(index.search([0, 0]), [])
        for v in ([1], [float('nan'), 1]):
            with self.assertRaises(ValueError):
                index.insert(v)
        with self.assertRaises(ValueError):
            index.search([0, 0], 10, 9)


if __name__ == '__main__':
    unittest.main()
