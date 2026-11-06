import hashlib
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from redis.exceptions import RedisError

from publisher import database, enqueue, queue, redis_client

app = FastAPI(title="LifeOS public document publisher")


class BuildRequest(BaseModel):
    key: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


@app.post("/builds", status_code=202)
def start(request: BuildRequest, authorization: str | None = Header(default=None)):
    if authorization != "Bearer " + os.environ.get("PUBLISH_TOKEN", "fictional-publisher"):
        raise HTTPException(401, "Publisher token required")
    build_id = hashlib.sha256(request.key.encode()).hexdigest()
    cache = redis_client()
    try:
        with cache.lock("lifeos:enqueue:" + build_id, timeout=10, blocking_timeout=3):
            with database() as db:
                previous = db.execute("SELECT state FROM builds WHERE id=?", (build_id,)).fetchone()
                if previous:
                    return {"id": build_id, "state": previous["state"]}
                # Enqueue before status: if the worker wins the race, do not overwrite published.
                enqueue(build_id)
                db.execute(
                    "INSERT INTO builds(id,state) VALUES(?, 'queued') ON CONFLICT(id) DO NOTHING", (build_id,)
                )
    except RedisError as error:
        raise HTTPException(503, "Queue unavailable; retry with the same key") from error
    return {"id": build_id, "state": "queued"}


@app.get("/builds/{build_id}")
def status(build_id: str):
    with database() as db:
        row = db.execute("SELECT * FROM builds WHERE id=?", (build_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Build not found")
    return dict(row)


@app.get("/search")
def search(q: str = ""):
    if not q.strip() or len(q) > 200:
        return {"pages": []}
    with database() as db:
        rows = db.execute(
            "SELECT path,title FROM pages WHERE instr(lower(title || ' ' || body),lower(?))>0 ORDER BY path LIMIT 20",
            (q,),
        ).fetchall()
    return {"pages": [dict(row) for row in rows]}


@app.get("/pages/{path:path}", response_class=HTMLResponse)
def page(path: str):
    with database() as db:
        row = db.execute("SELECT html FROM pages WHERE path=?", (path,)).fetchone()
    if row is None:
        raise HTTPException(404, "Page not found")
    return HTMLResponse(
        row["html"],
        headers={
            "Content-Security-Policy": "default-src 'none'; style-src 'self'",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/metrics")
def metrics():
    cache = redis_client()
    raw = {k.decode(): float(v) for k, v in cache.hgetall("lifeos:metrics").items()}
    return {
        "queue_depth": len(queue()),
        "cache_hit_rate": raw.get("cache_hits", 0) / max(raw.get("documents", 0), 1),
        **raw,
    }
