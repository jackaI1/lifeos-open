import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from api import app
from publisher import database, publish_tree, queue, redis_client, validate_tree


class Cache:
    def __init__(self):
        self.data = {}

    def get(self, key):
        return self.data.get(key)

    def set(self, key, value, **kwargs):
        self.data[key] = value

    def hincrby(self, *args):
        pass

    def hincrbyfloat(self, *args):
        pass


@pytest.fixture
def docs(tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLISH_DATABASE", str(tmp_path / "published.sqlite"))
    root = tmp_path / "docs"
    root.mkdir()
    (root / "day.mdx").write_text(
        "---\ntitle: Day\ndescription: Read the day\n---\n# Day\n\nStarts at 5 am.\n"
    )
    return root


def test_rerun_cache_and_invalidation(docs):
    cache = Cache()
    assert publish_tree(docs, "first", cache) == {"pages": 1, "cache_hits": 0}
    assert publish_tree(docs, "second", cache) == {"pages": 1, "cache_hits": 1}
    path = docs / "day.mdx"
    path.write_text(path.read_text().replace("5 am", "6 am"))
    assert publish_tree(docs, "third", cache) == {"pages": 1, "cache_hits": 0}
    with database() as db:
        assert db.execute("SELECT count(*) FROM pages").fetchone()[0] == 1
        assert "6 am" in db.execute("SELECT html FROM pages").fetchone()[0]
    path.unlink()
    (docs / "new.md").write_text("---\ntitle: New\ndescription: New page\n---\n# New\n")
    publish_tree(docs, "fourth", cache)
    with database() as db:
        assert db.execute("SELECT path FROM pages").fetchone()[0] == "new.md"


@pytest.mark.parametrize(
    "body",
    [
        "missing front matter",
        "---\ntitle: Day\n---\nNo description",
        "---\ntitle: Day\ndescription: Test\n---\n[bad](missing.md)",
        "---\ntitle: Day\ndescription: Test\n---\n```python\nx=1",
        "---\ntitle: Day\ndescription: Test\n---\n```\nx\n```",
        '---\ntitle: Day\ndescription: Test\n---\nimport X from "unsafe"',
        "---\ntitle: Day\ndescription: Test\n---\n[bad](day.mdx#missing)",
    ],
)
def test_validation_keeps_old_snapshot(docs, body):
    publish_tree(docs, "good", Cache())
    (docs / "day.mdx").write_text(body)
    with pytest.raises(ValueError):
        publish_tree(docs, "bad", Cache())
    with database() as db:
        assert "5 am" in db.execute("SELECT html FROM pages").fetchone()[0]


def test_link_validation_and_sanitized_html(docs):
    path = docs / "day.mdx"
    path.write_text(path.read_text() + "\n[day](day.mdx#day)\n\n<script>alert(1)</script>")
    with pytest.raises(ValueError):
        validate_tree(docs)
    path.write_text(path.read_text().replace("<script>alert(1)</script>", "`<script>alert(1)</script>`"))
    publish_tree(docs, "safe", Cache())
    client = TestClient(app)
    assert client.get("/search?q=Starts").json()["pages"][0]["path"] == "day.mdx"
    response = client.get("/pages/day.mdx")
    assert response.status_code == 200
    assert "<script>" not in response.text
    assert "default-src 'none'" in response.headers["content-security-policy"]


@pytest.mark.skipif(not os.environ.get("PUBLISH_REDIS_URL"), reason="Real Redis integration runs in CI")
def test_git_queue_retries_and_cache(docs, monkeypatch):
    import time

    from rq import SimpleWorker
    from rq.scheduler import RQScheduler

    root = docs.parent
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "docs"], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "Public fixture",
        ],
        check=True,
    )
    monkeypatch.setenv("PUBLISH_GIT_SOURCE", str(root))
    monkeypatch.setenv("PUBLISH_DOCS_PATH", "docs")
    redis_client().flushdb()  # CI owns this isolated Redis database.
    client = TestClient(app)
    assert client.post("/builds", json={"key": "first"}).status_code == 401

    def submit(key):
        return client.post(
            "/builds", json={"key": key}, headers={"Authorization": "Bearer fictional-publisher"}
        ).json()["id"]

    first = submit("first")
    assert submit("first") == first
    assert len(queue()) == 1
    SimpleWorker([queue()], connection=redis_client()).work(burst=True)
    assert client.get("/builds/" + first).json()["state"] == "published"
    submit("second")
    SimpleWorker([queue()], connection=redis_client()).work(burst=True)
    assert client.get("/metrics").json()["cache_hit_rate"] == 0.5
    # A failed clone is retried by the real queue; it never replaces published pages.
    monkeypatch.setenv("PUBLISH_DOCS_PATH", "missing")
    bad = submit("bad")
    SimpleWorker([queue()], connection=redis_client()).work(burst=True, with_scheduler=True)
    assert client.get("/builds/" + bad).json()["state"] == "failed"
    assert client.get("/search?q=Starts").json()["pages"]
    monkeypatch.setenv("PUBLISH_DOCS_PATH", "docs")
    scheduler = RQScheduler([queue()], connection=redis_client())
    scheduler.acquire_locks()
    try:
        time.sleep(1.1)
        scheduler.enqueue_scheduled_jobs()
    finally:
        scheduler.release_locks()
    SimpleWorker([queue()], connection=redis_client()).work(burst=True)
    assert client.get("/builds/" + bad).json()["state"] == "published"
