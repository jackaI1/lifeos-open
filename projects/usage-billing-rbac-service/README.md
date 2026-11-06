# usage-billing-rbac-service

I built a small billing and access service to learn how the underlying idea works. This is a learning project.

## Try it

You need Python 3.9 or newer. No packages or containers are needed. In a terminal, from this folder:

```sh
export BILLING_OWNER_KEY='replace-with-a-long-random-key'
python3 service.py --init-org acme --owner jack
python3 service.py
```

In another terminal, use the same key. These commands use the current UTC time and month:

Stop the server with Ctrl-C. The local SQLite file `billing.sqlite3` stores the records; use `--db PATH` to choose another file. Keep the file and keys private.

## How it works

An API key identifies a member within an organization. Send it in the `Authorization: Bearer` header. All routes check the member's role and account state. Owners can manage everything, admins can manage members and plans except owners, developers can record usage, and viewers can read invoices. Owners can restore a suspended account; closing an account is final. Suspended or closed accounts cannot read invoices or record usage.

Send JSON to these routes under `/orgs/{organization}`:

- `POST /members`: `{"name":"sam","role":"developer","key":"a-new-random-key"}` creates or updates a member. An organization must retain at least one owner.
- `POST /plans`: `{"plan":"pro","effective":"2026-11-15T00:00:00Z"}` records a plan change at a timezone-aware timestamp. The initial plan is `free`.
- `POST /usage`: `{"event_id":"request-1","units":5,"occurred":"2026-11-06T12:00:00Z"}` records positive whole units. A retry with identical data returns `created: false`; reusing the ID with different data returns a conflict.
- `POST /status`: `{"status":"suspended"}` changes the account state. An owner can also use `active` or `closed`.
- `GET /invoice?period=2026-11`: calculates the current invoice for a UTC calendar month.
- `GET /audit`: lists changes for owners and admins.

Prices are illustrative US cents: the free plan costs zero per month, the pro plan costs 5,000 cents per month, and usage costs one cent per unit for the first 100 units and two cents per unit thereafter. Plan fees are proportional to elapsed time in the month, including leap months, and rounded once to the nearest cent. Usage tiers apply across the whole month. Changes and events can be backdated after organization creation, so invoices are live calculations, not finalized payment records.

## Tests and limits

There are 1 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Retained project workflows: `usage-billing-rbac-service-ci.yml`. Their commands use this folder and their triggers use its paths.
