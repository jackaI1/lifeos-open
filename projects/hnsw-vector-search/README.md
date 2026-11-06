# hnsw-vector-search

I built a way to find similar words to learn how the underlying idea works. This is a learning project.

## Try it

Install Python 3.9 or newer and Git, then open a terminal and download the project:

```bash
python3
```

The last command opens the Python prompt. Paste these lines into it and press Enter:

```python
from hnsw import HNSW

index = HNSW(dimensions=3)
index.insert([0.1, 0.2, 0.3])  # Returns integer ID 0
index.insert([0.2, 0.2, 0.3])
index.save('vectors.json')
index = HNSW.load('vectors.json')
print(index.search([0.15, 0.2, 0.3], k=2, ef_search=20))
```

Type `exit()` and press Enter to leave Python. The file `vectors.json` is saved in the project directory.

Results are `(id, squared distance)` pairs, closest first. IDs are assigned in insertion order. The index uses squared Euclidean distance, so vectors must have the same dimensions and contain finite numbers. Save files are JSON and should only be loaded from trusted sources. Saving rewrites the file; it is not a transactional database. More vectors can be inserted after loading.

## Measure it yourself

```bash
curl -L https://raw.githubusercontent.com/thegreatbey/wink-embeddings-small-en-50d/2331c6118ba400f3beef08b366076e084db520a3/src/embeddings.json -o embeddings.json
python3 benchmark.py embeddings.json
python3 -m unittest discover -s tests -v
```

The benchmark shuffles with seed 42, indexes 1,000 vectors, and uses the next 100 as held-out queries. Exact search scans all indexed vectors. Recall@10 is the fraction of its ten closest results also found by the index, averaged across queries. Each latency is the mean wall-clock time for one query, including Python overhead; build time and file loading are excluded. You can change the sample with `--size` and `--queries`.

## Design

HNSW means hierarchical navigable small world. Each inserted vector gets a randomly chosen maximum layer; upper layers are sparse shortcuts. Insertion searches existing layers for candidates, links the closest ones, and limits each node to `m` links above the bottom layer and `2*m` at the bottom. Pruning can make links one-way. At query time, a greedy search descends through upper layers, then a wider search at the bottom keeps up to `ef_search` candidates. Higher values generally improve recall at a cost in time. Construction uses `ef_construction` to control its candidate pool. The implementation favors clarity over optimized numerical operations, concurrent writes, deletion, or very large datasets.

## Tests and limits

There are 1 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: (removed workflow).

The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.
