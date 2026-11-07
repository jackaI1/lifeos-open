"""Extractive answers: source text is the answer, never an invented completion."""
import json
import math
import os
from pathlib import Path
from urllib.request import Request, urlopen

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI
from pydantic import BaseModel, Field

ROOT = Path(__file__).parent


def embed(texts):
    request = Request(os.environ.get("EMBED_URL", "http://127.0.0.1:8792/embed"), data=json.dumps({"texts": texts}).encode(), headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=60) as response:
        data = json.load(response)
    if len(data["vectors"]) != len(texts) or any(len(v) != 384 or any(not math.isfinite(x) for x in v) for v in data["vectors"]):
        raise ValueError("Invalid local embedding output")
    return data


def connect():
    return psycopg.connect(os.environ["SHIFT_DATABASE_URL"], row_factory=dict_row)


def migrate_and_seed(db):
    db.execute((ROOT / "schema.sql").read_text())
    reports = json.loads((ROOT / "reports.json").read_text())
    embeddings = embed([r["passage"] for r in reports])
    for report, vector in zip(reports, embeddings["vectors"], strict=True):
        db.execute("INSERT INTO shift_passages(id,document,shift,passage,embedding,model) VALUES(%s,%s,%s,%s,%s::vector,%s) ON CONFLICT(id) DO UPDATE SET document=excluded.document,shift=excluded.shift,passage=excluded.passage,embedding=excluded.embedding,model=excluded.model", (report["id"], report["document"], report["shift"], report["passage"], json.dumps(vector), embeddings["model"]))
    db.commit()


def search(db, question, mode="hybrid", k=3, threshold=0.35):
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 2000 or mode not in {"hybrid", "fulltext", "vector"}:
        raise ValueError("Invalid question or search mode")
    data = embed([question])
    vector = json.dumps(data["vectors"][0])
    fulltext = db.execute("SELECT id,document,shift,passage,ts_rank_cd(search,websearch_to_tsquery('english',%s)) AS rank FROM shift_passages WHERE search @@ websearch_to_tsquery('english',%s) AND model=%s ORDER BY rank DESC,id LIMIT 20", (question, question, data["model"])).fetchall()
    vectors = db.execute("SELECT id,document,shift,passage,1-(embedding <=> %s::vector) AS similarity FROM shift_passages WHERE model=%s ORDER BY embedding <=> %s::vector,id LIMIT 20", (vector, data["model"], vector)).fetchall()
    scores, rows = {}, {}
    lists = [fulltext, vectors] if mode == "hybrid" else [fulltext if mode == "fulltext" else vectors]
    for ranking in lists:
        for rank, row in enumerate(ranking, 1):
            rows[row["id"]] = row
            scores[row["id"]] = scores.get(row["id"], 0) + 1 / (60 + rank)
    similarity = {r["id"]: r["similarity"] for r in vectors}
    hits = [{**rows[key], "score": scores[key], "similarity": similarity.get(key, 0)} for key in sorted(scores, key=lambda key: (-scores[key], key))[:k]]
    abstained = not hits or hits[0]["similarity"] < threshold
    return {"answer": "I do not have a strong enough source." if abstained else hits[0]["passage"], "abstained": abstained, "sources": [] if abstained else hits, "candidates": hits, "mode": mode, "model": data["model"]}


app = FastAPI()
class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


@app.post("/search")
def answer(body: Question):
    with connect() as db:
        return search(db, body.question)


if __name__ == "__main__":
    with connect() as db:
        migrate_and_seed(db)
