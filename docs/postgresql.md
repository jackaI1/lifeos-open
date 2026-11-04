# Self-hosted PostgreSQL

The standalone Node 24 service supports PostgreSQL 17+ via `pg` (node-postgres).
SQLite remains the default. The browser demo and hosted SQLite/D1 adapters retain
their existing storage paths. PostgreSQL is for one self-hosted workspace, with
one application process serializing mutations as before.

## Start

Create an empty PostgreSQL database owned by the application user. Put its
connection URL in your ignored `.env` as `DATABASE_URL`, then run `npm run dev`
(or `npm run build && npm start`). `DATABASE_URL` takes precedence over
`LIFEOS_DATABASE`. Leave it unset to use SQLite. Use URL-encoded passwords and
PostgreSQL's `sslmode=verify-full` with a trusted CA for remote deployments.
Do not disable certificate verification. Keep the service's loopback binding;
public access still requires an operator-managed HTTPS/authentication layer.

The shared contract is [`src/storage/types.ts`](../src/storage/types.ts).
[`postgres.ts`](../src/storage/postgres.ts) owns a pool of at most five clients,
with 5-second connection and 30-second statement timeouts. Statements bind values
separately using `$n` parameters; identifiers in transfer/catalog operations are
validated. Transactions check out one client and always commit/roll back and
release it. Service shutdown awaits in-flight requests and drains the pool.
This follows node-postgres's [query](https://node-postgres.com/features/queries),
[pool](https://node-postgres.com/features/pooling) and
[transaction](https://node-postgres.com/features/transactions) contracts.

The SQL compatibility compiler supports the application's SQLite/D1 query subset:
question-mark parameters, JSON paths, scalar min/max, integer assertions and the
upserts used by the demo upgrader. It preserves quoted strings/comments. JSON
booleans remain comparable to SQLite's 0/1, numeric comparisons use numeric casts,
and JSON-to-JSON comparisons retain numeric ordering. Millisecond timestamps use
BIGINT and binary objects use BYTEA. Returned integers must fit JavaScript's safe
integer range. This is not a general SQLite SQL translator or a MySQL backend.

## Migrations

[`src/storage/migrations/`](../src/storage/migrations/) contains paired versioned
SQL files for SQLite and PostgreSQL. Startup applies unapplied numeric versions
in order within a transaction and records them in `_workspace_migrations`.
PostgreSQL holds an advisory transaction lock during upgrades. An existing SQLite
workspace adopts the idempotent baseline without clearing or reseeding records.
Add matching numbered files in both dialect directories for future changes;
never edit an already deployed version. Cloudflare/browser deployments continue
using `src/cloud/schema.sql` and their existing migration workflow.

## Transfer an existing SQLite workspace

1. Stop the application and any workers writing the SQLite file. Retain a backup.
2. Create an empty PostgreSQL database. Do not start LifeOS against it yet.
3. Set `DATABASE_URL` in `.env`, then run:

   ```sh
   npm run db:import -- /absolute/path/workspace.sqlite
   ```

4. Start LifeOS with the same URL. Imported initialization markers prevent reseeding.

[`tools/sqlite-to-postgres.mjs`](../tools/sqlite-to-postgres.mjs) opens the source
read-only, takes a consistent SQLite read transaction, and uses the existing
backup verifier to check object checksums/references before importing. It locks
the destination tables and refuses any populated destination. Data, file bytes,
revision counts, and deleted-entry state are copied in one PostgreSQL transaction.
A canonical read-back comparison checks every exported table/row/cell before
commit; the command prints table/row/byte counts and a SHA-256 digest, never data
or the connection URL. Failure rolls back imported data; empty migrated tables
may remain. Existing target data is never replaced.

As with local backup/restore, sessions, OAuth logins, worker credentials, old
local snapshots and internal `_` tables are excluded. Sign in again and
reenroll workers after transfer. Fictional seed originals are internal and not
transferred; ordinary private records and local file bytes are included. The
source file limit is 512 MiB and transfer materializes its snapshot in memory;
large installations should use an operator-reviewed streaming migration instead.
Keep the source for rollback: switching back does not synchronize later writes.

Settings export and verified backups also work with PostgreSQL, using the same
portable backup format; the existing `npm run restore` writes a new SQLite file.

## Index choices

Both schemas retain the same application indexes; PostgreSQL expression indexes
use immutable JSON extraction functions matching the query compiler.

| Index family | Purpose |
| --- | --- |
| `records` primary key; `record_kind_updated` | Point reads/optimistic updates; kind-scoped pages ordered by modification time |
| `calendar_record_source`, `routine_*` | Provider reconciliation and bounded date/status/calendar bootstrap queries |
| `assistant_*`, `inspire_task_job`, `lecture_study_*` | Partial indexes narrow thread messages, lecture reviews and linked jobs to their record/type subsets |
| `finance_record_day` | Date-ordered transaction pages without scanning unrelated records |
| `audit_created`, `audit_record_version` | Recent activity and revision history by record/version |
| `job_claim`, `job_lease`, `job_created` | Ready-job selection, expired leases and recent job history |
| `backup_page`, `deleted_by_entry`, `deleted_entry_order` | Bounded backup cursors and deleted-entry listing/restoration |
| `*_drive_id` | Linked-file lookup during deletion without scanning object/chunk tables |
| `session_expiry`, `ai_reservation_expiry`, `source_status`, `notification_receipt_time` | Expiry cleanup, pending-source work and receipt history |

Unique/primary-key indexes also enforce mutation idempotency, deduplication,
chunk order and stable record identities. Partial/expression indexes incur write
cost; they target existing query predicates rather than indexing every JSON key.

### EXPLAIN example: assistant history

On a disposable PostgreSQL 18.6 fixture with 10,000 fictional messages across
100 threads, after `ANALYZE records`, run:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM records
WHERE kind='support-message'
  AND lifeos_json_extract(data,'$.threadId')='thread-42'
ORDER BY created_at DESC LIMIT 60;
```

A measured local plan (not a latency guarantee):

```text
Limit (actual time=0.120..0.124 rows=60 loops=1)
  -> Sort (Sort Key: created_at DESC; Memory: 50kB)
       -> Bitmap Heap Scan on records (actual rows=100)
            -> Bitmap Index Scan on assistant_message_thread (actual rows=100)
                 Index Cond: lifeos_json_extract(data,'$.threadId') = 'thread-42'
Execution Time: 0.139 ms
```

The partial index selects the 100 matching messages before the bounded sort.
Small demo datasets may correctly choose a sequential scan. Repeat EXPLAIN on
your own data after ANALYZE rather than forcing an index or copying timings.

## Test both backends

```sh
npm test
TEST_DATABASE_URL=postgresql://YOUR_TEST_USER:YOUR_TEST_PASSWORD@127.0.0.1:5432/YOUR_TEST_DATABASE npm test
```

Use a disposable test database: the PostgreSQL test role needs schema creation
permission. Each API fixture creates and drops a unique schema and drains its
pool in `finally`. The same existing API suite runs through both adapters;
SQLite file-persistence and hosted/browser-specific tests still exercise their
native engines in both matrix jobs. New contracts cover atomic rollback,
concurrent transaction isolation, JSON ordering, blobs, migration idempotency,
source checksum failures and failed/duplicate imports. CI uses a PostgreSQL 17
service container and runs the full unit/API suite in both matrix jobs.
