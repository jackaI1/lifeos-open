"""Benchmark held-out GloVe-derived vectors against exact search."""
import argparse
import json
import random
import statistics
import time
from hnsw import HNSW, exact


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset', help='wink embeddings.json')
    parser.add_argument('--size', type=int, default=1000)
    parser.add_argument('--queries', type=int, default=100)
    args = parser.parse_args()
    with open(args.dataset, encoding='utf-8') as f:
        vectors = list(json.load(f).values())
    random.Random(42).shuffle(vectors)
    if args.size < 10 or args.queries < 1 or len(vectors) < args.size + args.queries:
        parser.error('need at least 10 indexed vectors and enough held-out queries')
    base, queries = vectors[:args.size], vectors[args.size:args.size + args.queries]
    index = HNSW(len(base[0]))
    start = time.perf_counter()
    for vector in base:
        index.insert(vector)
    print(f'build: {time.perf_counter() - start:.2f} s; base={len(base)}, queries={len(queries)}')
    truth, timings = [], []
    for q in queries:
        start = time.perf_counter_ns()
        truth.append({i for i, _ in exact(base, q)})
        timings.append((time.perf_counter_ns() - start) / 1e6)
    print(f'exact: mean {statistics.mean(timings):.3f} ms/query, recall@10 1.000')
    for ef in (10, 20, 40, 80):
        timings, recalls = [], []
        for q, expected in zip(queries, truth):
            start = time.perf_counter_ns()
            found = index.search(q, 10, ef)
            timings.append((time.perf_counter_ns() - start) / 1e6)
            recalls.append(len(expected & {i for i, _ in found}) / 10)
        print(f'ef={ef}: mean {statistics.mean(timings):.3f} ms/query, recall@10 {statistics.mean(recalls):.3f}')


if __name__ == '__main__':
    main()
