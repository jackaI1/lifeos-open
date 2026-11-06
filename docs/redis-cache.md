# Optional saved-record cache

I added this for repeated reads of saved records, such as reminder pages, support
messages and coursework comparisons. Redis keeps a temporary copy in memory so
those reads can avoid loading and decoding the same database rows. The database
still owns every record. Redis is optional, and it is usually unnecessary for a
small SQLite workspace.

## Try it

Install Node.js 24+, Docker and Compose v2. From the repository root:

```sh
npm ci
docker compose --profile redis up -d --wait redis
REDIS_URL=redis://127.0.0.1:6379 npm run dev
```

Open <http://127.0.0.1:8787>. The normal workspace screens use the same API.
To see a cache fill and then a hit in another terminal:

```sh
curl -i http://127.0.0.1:8787/api/records/task
curl -i http://127.0.0.1:8787/api/records/task
```

The first response has `X-LifeOS-Cache: miss`; the second has `hit`. A database
change makes the next read a miss. `bypass` means the database served the read
because Redis failed, the revision changed during the read, or the result was
too large. Authentication is still required when I use authenticated local mode.
Responses retain the existing `Cache-Control: no-store` browser policy.

To run the app in Compose too:

```sh
REDIS_URL=redis://redis:6379 docker compose --profile redis up --build
```

For a host app I use `127.0.0.1`; inside Compose I use the service name `redis`.
An empty `REDIS_URL` disables the cache. `REDIS_PORT=16379` changes the published
host port if 6379 is already used; the host app's URL must match that port.
Ctrl-C stops a foreground app. Stop the Redis service with
`docker compose --profile redis down`. This preserves the workspace database;
adding `--volumes` would delete its saved volume. Redis has no persistent data.

## Why a write cannot leave a usable old cache entry

The cached routes are `GET /api/records/:kind` and
`GET /api/records/:kind/:id`, including separate list pages. These are used by
the cooking, reminders, support, coursework and run-log screens. Bootstrap,
time-dependent schedules, sessions, jobs, files and private service routes keep
their existing database behavior. The browser-only public demo does not use Redis.

Each record has a version. The database also keeps a revision counter for each
record type, called a kind. Database triggers, small rules that run with a
write, advance that counter on every insert, update and delete. The counter
changes in the same transaction as the records and rolls back if the write fails.
This includes direct worker SQL, moving records to Deleted and restoring them.

The cache key includes the kind revision and the record ID or page bounds. Every
read checks that revision in SQL before looking in Redis. A write makes the old
key unreachable even when Redis is offline, so invalidation does not rely on
sending a deletion message. It applies to changes in the cached record type;
unrelated record types keep their useful copies. The original insert/update
triggers already existed; migration 0002 adds raw-delete coverage for both
SQLite and PostgreSQL.

I check the revision again before returning a hit or saving a fill. If a write
races with either operation, I bypass caching. A request overlapping a write
may return a database snapshot from that request; a read started after a
committed write cannot select its previous cache key. I do not cache errors or
missing-record responses, and I never fall back to an old cache value when the
database itself fails.

Authentication and origin validation happen before the cached route. Only the
same filtered JSON that the route normally returns is stored. Each running
service has a random namespace, a prefix that isolates its cache keys from other
workspaces and previous runs. Restarting the app starts cold, and separate app
processes do not share warm entries. Restoring a backup uses a new service run.
Do not reset revision counters or replace the database under a running service.

## Failure handling and storage

Connection setup, including the Redis handshake, and individual commands have a
100 ms deadline. A failure destroys that connection and skips Redis for one
second. The next request after that pause tries again. There is no offline
command queue, background reconnection loop or stale-value fallback. Writes do
not contact Redis. `app.close()` destroys its cache connection.

Entries expire after 60 seconds; that cleans up old keys rather than determining
freshness. Responses larger than 2 MiB are not cached. Compose limits Redis to
64 MiB and evicts less recently used keys when full. The Redis port is bound to
loopback and storage persistence is disabled. Cached content can contain my
workspace records, so I use a trusted local instance. A remote deployment needs
its own access controls and encrypted `rediss://` connection. No Redis address,
record content or credentials are logged by the adapter.

## Tests and benchmark

With the disposable Redis service running:

```sh
TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:cache
TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
REDIS_URL=redis://127.0.0.1:6379 npm run benchmark:cache
```

The focused suite has 17 checks, including its group, for real hits and misses,
API writes, worker updates, raw deletes, recreation, rollback, pagination,
workspace isolation, authentication, corrupt entries, response size, racing
writes, database failure, lost connections, stalled handshakes and stalled
commands. Without `TEST_REDIS_URL`, ordinary tests still check disabled and
unreachable Redis; the real-server group is explicitly skipped. CI starts Redis
with Compose, runs the suite for SQLite and PostgreSQL, runs the benchmark and
stops Redis even on failure.

The benchmark seeds 500 fictional tasks, warms each path ten times, then
interleaves 60 reads of each. It verifies byte-identical responses, reports
median (p50) and 95th-percentile (p95) handler latency, and counts record-payload
queries. SQL revision checks still happen on hits. It excludes HTTP transport
and does not add artificial database delay. `BENCH_READS` accepts 10 to 500.

One Mac run with local Docker services and a 605,401-byte response gave:

| Database | Uncached p50 / p95 | Redis p50 / p95 | Payload queries, uncached / cached |
| --- | --- | --- | --- |
| SQLite in memory | 1.758 / 2.087 ms | 3.346 / 3.850 ms | 60 / 0 |
| PostgreSQL in Docker | 6.568 / 10.711 ms | 6.045 / 9.217 ms | 60 / 0 |

Redis reduced database payload work in both runs but made in-memory SQLite
slower. The size of the records, service placement and machine load change the
latency result. I keep it off unless measurement justifies it. To benchmark
PostgreSQL, set `BENCH_DATABASE_URL` to a local test database too; the tool creates
and removes a unique schema rather than touching an existing workspace.
