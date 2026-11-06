# signed-webhook-receiver

I built a small order receiver to learn how the underlying idea works. This is a learning project.

## Try it locally

You need Node.js 22 or later and a PostgreSQL database. Create an empty database, then set its connection URL and a secret in your shell (use your own values):

```sh
npm ci
export DATABASE_URL='postgres://localhost:5432/webhooks'
export WEBHOOK_SECRET='replace-with-a-long-random-secret'
npm run migrate
npm start
```

In another terminal, set the same two environment variables and run `npm run worker`. In a third, set `WEBHOOK_SECRET` and run `npm run simulate`. Inspect the `deliveries`, `events`, `orders`, `audit_log`, and `dead_letters` tables with your PostgreSQL client. The failing event is retried up to five times, with a growing delay, then moved to the dead-letter list. After fixing the cause, run `npm run replay -- EVENT_ID` to queue it again. Replay applies to saved pending or dead events; a sender must resend an event that never reached this service.

## Approvals and reminders

## How it is put together

The receiver checks an HMAC-SHA256 signature against the exact request bytes, using a constant-time comparison and a five-minute timestamp window. The event ID is the database primary key; saving the event and its delivery record happens in one transaction. Invalid deliveries are logged too, except when the database itself is unavailable, in which case the service returns an error so the sender can retry. The worker claims rows with a database lock, retries with exponential backoff, and stores exhausted events in `dead_letters`. Order creation and completion share a transaction; stale claims can be recovered after five minutes. Handlers should stay shorter than that lease and must make any external side effects idempotent.

`db/001_schema.sql` enables row-level security (database rules that filter rows) on orders. A trusted API must set `request.jwt.claim.sub` from a verified user token; a representative can then read only their own orders. Database owners and roles with bypass privileges bypass these rules, so never use the service credentials in a client. Writes are reserved for trusted backend roles. `db/reconcile.sql` finds incomplete order events and dead letters. The order audit trigger records creation and status changes. In Supabase, apply the schema in the SQL editor and use a trusted backend connection; configure grants and the verified JWT context for your deployment before exposing access.

## Tests and limits

There are 1 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Retained project workflows: `signed-webhook-receiver-test.yml`. Their commands use this folder and their triggers use its paths.
