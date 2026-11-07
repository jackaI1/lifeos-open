CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS shift_passages (
 id TEXT PRIMARY KEY,
 document TEXT NOT NULL,
 shift TEXT NOT NULL,
 passage TEXT NOT NULL,
 embedding vector(384) NOT NULL,
 model TEXT NOT NULL,
 search tsvector GENERATED ALWAYS AS (to_tsvector('english',passage)) STORED
);
CREATE INDEX IF NOT EXISTS shift_passages_fts ON shift_passages USING gin(search);
CREATE INDEX IF NOT EXISTS shift_passages_vector ON shift_passages USING hnsw(embedding vector_cosine_ops);
