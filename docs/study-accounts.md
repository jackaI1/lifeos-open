# My fictional account examples

I built a few small account services because I wanted to learn what happens when
a request is retried or two changes arrive together. They sit beside the LifeOS
study desk and use fictional amounts. They are not a banking system.

## Settle a materials trade

On a Linux development machine with Docker:

```sh
docker compose -f compose.study.yaml up -d --build --wait vectors ledger
curl http://127.0.0.1:8082/balances
curl -X POST http://127.0.0.1:8082/trades \
  -H 'Idempotency-Key: example-trade' -H 'Content-Type: application/json' \
  -d '{"source":"student","destination":"materials","amount_cents":2500}'
# Copy the returned trade ID:
curl -X POST http://127.0.0.1:8082/trades/TRADE_ID/settle \
  -H 'Idempotency-Key: example-settlement'
curl http://127.0.0.1:8082/audit
```

The Go service starts with three synthetic accounts: student has 100,000 cents,
and materials and lab have zero. Creating a trade records intent; settling it
moves a balance. Every settlement appends two entries of opposite sign so their
sum is zero. These journal entries describe changes from the synthetic opening
balances. `/audit` returns the first 1,000 entries in order.

An idempotency key identifies one request. Repeating it returns the same trade;
changing its meaning is a conflict. A transaction, a set of changes that succeed
together, records the key, checks the balance, updates both accounts and appends
the journal. PostgreSQL locks the trade and both account rows. Account locks use
a fixed order to prevent deadlocks; competing trades cannot overspend the same
balance. A failed transaction keeps neither its posting nor its new key, so the
request can be tried again. Settlement remains safe even with a different key
because a settled trade is never posted twice. A database trigger rejects edits
and deletions of audit entries.

`GET /healthz` checks the database. Errors use JSON and 400, 404 or 409 status
codes. The development API binds localhost and has no production authentication.
The image uses a non-root runtime. This is a single-currency teaching ledger,
without fees, reconciliation, access control or a real broker connection.

To develop with Go 1.25 and a running Postgres database:

```sh
cd services/ledger
export LEDGER_DATABASE_URL='postgresql://study:fictional-study@127.0.0.1:5433/study?sslmode=disable'
go vet ./...
go test -race -count=1 -v ./...
go run .
```

Integration tests reset only the configured test database. Use a dedicated database,
not a personal workspace. Twenty concurrent 10,000-cent settlement attempts can
settle exactly ten trades from 100,000 cents. Tests check zero journal sum,
nonnegative balances, repeated keys, rollback and immutable audit rows.

## Retry a simulated payment

```sh
docker compose -f compose.study.yaml --profile payments up -d localstack
cd integrations/payments
npm ci
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
export AWS_ENDPOINT_URL=http://127.0.0.1:4566
npm run lint
npm run typecheck
npm test
npm run build
sam validate --lint --template-file template.yaml
sam build --template-file template.yaml
```

LocalStack emulates AWS DynamoDB, the key-value database holding requests,
payments and the simulated provider's receipts. The integration test creates and
deletes its own table. It calls the real Lambda handler against that database,
including ten concurrent retries, a reply lost after capture and a lost refund
reply. CI also builds the AWS SAM template, which describes Lambda handlers
behind API Gateway routes. It does not deploy them to a live AWS account.

For SAM local, create a `lifeos-payments` table in LocalStack using the `pk` string
partition key, then use an uncommitted `sam-env.json`:

```json
{"Payments":{"PAYMENTS_TABLE":"lifeos-payments","AWS_ENDPOINT_URL":"http://host.docker.internal:4566","AWS_REGION":"us-east-1","AWS_ACCESS_KEY_ID":"test","AWS_SECRET_ACCESS_KEY":"test"}}
```

Run `sam local start-api --env-vars sam-env.json`. On Linux add
`--add-host host.docker.internal:host-gateway` if the Docker host name is not
available. POST to <http://127.0.0.1:3000/payments> with
`Idempotency-Key: example-1` and
`{"amount_cents":500,"account":"fictional-student"}`. The other routes are
`POST /payments/{id}/retry` and `POST /payments/{id}/refund`, each with its own key.

The state moves from pending to captured to refunded. A pending payment cannot
be refunded, and a refunded payment cannot be captured again. Conditional writes
prevent changed requests from reusing a key. The simulated provider persists
one receipt per payment operation, so a timeout after posting cannot double-post
on retry. `SimulatedProvider` can inject a failure before posting or a lost reply
afterward; handler tests exercise both paths. In a real integration the external
provider would need an equivalent idempotency guarantee. There is no real payment
provider, money or live AWS account here. Structured error responses and logs
exclude account payloads and credentials.

Stop SAM with Ctrl-C and remove its local environment file. `sam delete` tears
down a stack if one was deliberately deployed; no live stack is created by these
commands. Do not deploy this unauthenticated fictional API as a payment service.

## Compare GraphQL and REST

The Next.js app exposes a separate schema-first accounts API at `POST /api/graphql`.
A schema describes the fields a client can ask for. These examples live in memory
and reset on process restart; they are separate from the durable Go ledger.

```sh
curl http://localhost:3000/api/graphql \
  -H 'Authorization: Bearer fictional-student' -H 'Content-Type: application/json' \
  -d '{"query":"{ accounts(first:1) { nodes { id name balanceCents } endCursor hasNextPage } }"}'
curl http://localhost:3000/api/accounts -H 'Authorization: Bearer fictional-student'
```

GraphQL returns only requested fields. The comparison REST endpoint returns the
current viewer's authorized accounts and balances in a fixed shape. Public
account names are visible to an authenticated fictional viewer; `balanceCents`
and `transactions` each check ownership or staff access. The staff token is
`fictional-staff`; `ACCOUNTS_STUDENT_TOKEN` and `ACCOUNTS_STAFF_TOKEN` replace these
local defaults. This is token-based demo authorization, not an identity service.

The schema in `apps/today/lib/accounts.ts` defines:

- `accounts(first, after)` and `account(id)` queries;
- `Account.transactions(first, after)` with a maximum page of 50;
- `addTransaction(input: {accountId, amountCents, memo})`, a validated mutation;
- connections containing `nodes`, `endCursor` and `hasNextPage`.

Use the previous `endCursor` as `after`. Unknown cursors are rejected. A depth
limit of six counts fields through fragments and inline fragments. Cyclic
fragments and queries larger than 12,000 characters are rejected. Resolver tests
check pagination, mutation validation, per-field denial and staff access. This
example does not implement double-entry bookkeeping; use the Go service to study
settlement invariants.
