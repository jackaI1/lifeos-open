"""Validate public Markdown, then publish an atomic snapshot through Redis/RQ."""

import hashlib
import json
import logging
import os
import re
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit

import bleach
import yaml
from markdown_it import MarkdownIt
from redis import Redis
from rq import Queue, Retry

log = logging.getLogger("lifeos.publisher")
TRANSFORM_VERSION = "markdown-v1"
MAX_FILES = 250
MAX_BYTES = 2_000_000


def redis_client():
    return Redis.from_url(os.environ.get("PUBLISH_REDIS_URL", "redis://127.0.0.1:6380/0"))


def queue():
    return Queue("lifeos-docs", connection=redis_client(), default_timeout=120)


def database():
    db = sqlite3.connect(os.environ.get("PUBLISH_DATABASE", "published.sqlite"), timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS pages(path TEXT PRIMARY KEY,title TEXT NOT NULL,html TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS builds(id TEXT PRIMARY KEY,state TEXT NOT NULL,error TEXT,revision TEXT);
    """)
    return db


def validate_tree(root):
    root = Path(root).resolve()
    paths = sorted(p for p in root.rglob("*") if p.suffix in {".md", ".mdx"})
    if not paths or len(paths) > MAX_FILES:
        raise ValueError("Use between 1 and 250 documents")
    if any(p.is_symlink() or root not in p.resolve().parents for p in paths):
        raise ValueError("Document symlinks are not allowed")
    if sum(p.stat().st_size for p in paths) > MAX_BYTES:
        raise ValueError("Document set exceeds 2 MB")
    markdown = MarkdownIt("commonmark", {"html": False})
    docs = {}
    parsed = {}
    for path in paths:
        text = path.read_text()
        match = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
        if not match:
            raise ValueError(f"{path.name}: front matter required")
        metadata = yaml.safe_load(match[1])
        if not isinstance(metadata, dict) or any(
            not isinstance(metadata.get(k), str) or not metadata[k].strip() for k in ["title", "description"]
        ):
            raise ValueError(f"{path.name}: title and description required")
        body = match[2]
        # MDX's Markdown subset is accepted; JSX/imports are rejected rather than executed.
        if re.search(r"^\s*(import |export |<[A-Za-z])", body, re.M):
            raise ValueError(f"{path.name}: executable MDX/HTML is not supported")
        opened = None
        for line in body.splitlines():
            fence = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
            if not fence:
                continue
            marker, rest = fence.groups()
            if opened is None:
                opened = marker
            elif marker[0] == opened[0] and len(marker) >= len(opened) and not rest.strip():
                opened = None
        if opened:
            raise ValueError(f"{path.name}: unclosed code block")
        tokens = markdown.parse(body)
        for token in tokens:
            if token.type == "fence":
                if token.info.strip().split(" ")[0] not in {
                    "bash",
                    "sh",
                    "python",
                    "typescript",
                    "javascript",
                    "json",
                    "yaml",
                    "text",
                    "sql",
                    "go",
                }:
                    raise ValueError(f"{path.name}: code blocks need a supported language")
        docs[path.relative_to(root).as_posix()] = {"title": metadata["title"], "body": body, "raw": text}
        parsed[path] = tokens
    for path, tokens in parsed.items():
        for block in tokens:
            for token in block.children or []:
                if token.type not in {"link_open", "image"}:
                    continue
                link = token.attrGet("href") or token.attrGet("src") or ""
                parts = urlsplit(link)
                if parts.scheme:
                    if parts.scheme not in {"https", "http", "mailto"}:
                        raise ValueError("Unsupported link scheme")
                    continue
                dest = (path.parent / unquote(parts.path)).resolve() if parts.path else path
                if dest != root and root not in dest.parents:
                    raise ValueError("Link escapes the document set")
                if not dest.is_file() or dest.is_symlink():
                    raise ValueError(f"Broken local link: {link}")
                if parts.fragment and dest.suffix in {".md", ".mdx"}:
                    target = dest.read_text()
                    anchors = {
                        re.sub(r"[^\w-]", "", title.lower().replace(" ", "-"))
                        for title in re.findall(r"^#+ (.+)$", target, re.M)
                    }
                    if unquote(parts.fragment) not in anchors:
                        raise ValueError(f"Broken heading link: {link}")
    return docs


def publish_tree(root, build_id, cache=None):
    started = time.monotonic()
    cache = cache or redis_client()
    docs = validate_tree(root)  # Validate everything before touching the visible snapshot.
    hits = 0
    pages = []
    markdown = MarkdownIt("commonmark", {"html": False})
    tags = set(bleach.sanitizer.ALLOWED_TAGS) | {"p", "h1", "h2", "h3", "h4", "pre", "br", "hr"}
    for path, doc in docs.items():
        digest = hashlib.sha256((TRANSFORM_VERSION + doc["raw"]).encode()).hexdigest()
        cached = cache.get("lifeos:html:" + digest)
        if cached:
            hits += 1
            html = cached.decode() if isinstance(cached, bytes) else cached
        else:
            html = bleach.clean(markdown.render(doc["body"]), tags=tags)
            cache.set("lifeos:html:" + digest, html, ex=86400)
        pages.append((path, doc["title"], html, doc["body"], digest))
    with database() as db:
        db.execute("DELETE FROM pages")
        db.executemany("INSERT INTO pages VALUES(?,?,?,?,?)", pages)
        db.execute(
            "INSERT INTO builds(id,state,error) VALUES(?,?,NULL) ON CONFLICT(id) DO UPDATE SET state=excluded.state,error=NULL",
            (build_id, "published"),
        )
    duration = time.monotonic() - started
    cache.hincrby("lifeos:metrics", "documents", len(pages))
    cache.hincrby("lifeos:metrics", "cache_hits", hits)
    cache.hincrby("lifeos:metrics", "builds", 1)
    cache.hincrbyfloat("lifeos:metrics", "duration_seconds", duration)
    log.info(
        json.dumps(
            {
                "event": "published",
                "build_id": build_id,
                "pages": len(pages),
                "cache_hits": hits,
                "duration_seconds": round(duration, 4),
            }
        )
    )
    return {"pages": len(pages), "cache_hits": hits}


def build(build_id):
    repo = os.environ["PUBLISH_GIT_SOURCE"]
    folder = os.environ.get("PUBLISH_DOCS_PATH", "docs/public-guide")
    with database() as db:
        db.execute("UPDATE builds SET state='running',error=NULL WHERE id=?", (build_id,))
    try:
        with tempfile.TemporaryDirectory(prefix="lifeos-public-docs-") as temp:
            # Source is operator configuration, never an API-supplied arbitrary URL.
            subprocess.run(
                [
                    "git",
                    "-c",
                    "protocol.file.allow=always",
                    "clone",
                    "--depth",
                    "1",
                    "--no-hardlinks",
                    "--",
                    repo,
                    temp,
                ],
                check=True,
                capture_output=True,
                timeout=45,
            )
            revision = subprocess.check_output(["git", "-C", temp, "rev-parse", "HEAD"], text=True).strip()
            root = (Path(temp) / folder).resolve()
            if Path(temp).resolve() not in root.parents:
                raise ValueError("Document directory escapes checkout")
            result = publish_tree(root, build_id)
            with database() as db:
                db.execute("UPDATE builds SET revision=? WHERE id=?", (revision, build_id))
            return result
    except Exception as error:
        with database() as db:
            db.execute(
                "UPDATE builds SET state='failed',error=? WHERE id=?",
                (type(error).__name__ + ": build failed; check worker logs", build_id),
            )
        log.error(
            json.dumps({"event": "build_failed", "build_id": build_id, "error_type": type(error).__name__})
        )
        raise


def enqueue(build_id):
    return queue().enqueue(
        build, build_id, job_id=build_id, retry=Retry(max=2, interval=[1, 3]), result_ttl=86400
    )
