# Isolated hosted fictional demo

The standalone app remains the default. The optional hosted entry uses `wrangler.public.example.jsonc` and `src/hosted/worker.ts`; it must have its own HTTPS origin and storage. Never attach personal D1, Drive credentials, AI credentials, service bindings or real integrations.

## Configuration

Review the exact `DEMO_ORIGIN` and `PARENT_ORIGIN` values. Supply a separate random `SESSION_SECRET` of at least 32 characters through the hosting secret manager; never commit it. Only `ASSETS`, `WORKSPACES`, `ADMISSION`, `DEMO_ORIGIN`, `PARENT_ORIGIN` and `SESSION_SECRET` bindings are accepted. The example contains no routes and disables provider preview URLs.

The compatibility date is deliberately `2026-09-07`, the locally tested runtime. SQLite Durable Objects must be available on the actual account. Confirm Free entitlement, shared account headroom and adequate upstream traffic protection before publishing. Application counters do not prevent platform invocations or protect another Worker's account quota from abusive traffic. Do not enable billing or assume overage is approved.

## Visitor behavior

Every visitor receives a signed, host-only HttpOnly cookie and a separate SQLite Durable Object. The workspace has authored fictional records and mock services. Browser drafts, recordings and recovery databases are scoped to the current visitor generation before the app loads. Reset rotates this generation; stale tabs cannot synchronize into the reset workspace. Old browser generations are not automatically erased, so avoid entering real personal information into the demo.

Reset affects only that visitor's server workspace. Export downloads that visitor's records and files; it excludes session and platform control tables. Server data expires after 24 hours of inactivity. Limits are 20 MiB stored data, 1 MiB per request, 60 requests/minute/visitor, 25 newly admitted visitors/day, and 10,000 admitted dynamic requests/day. They are application safeguards, not platform billing caps.

## Verification and release

Run the normal unit tests, type check, lint, privacy scan and standalone build. Bundle the hosted Worker with Wrangler's `deploy --dry-run --config wrangler.public.example.jsonc --outdir .runtime/hosted/build`. The runtime tests in `tools/hosted-runtime.test.mjs` and `tools/hosted-app.test.mjs` require the existing Miniflare toolchain; set `LIFEOS_WORKER_TOOLCHAIN` to its package directory when it is outside this repository. Every test runtime disposes its owned resources.

Before enabling the parent frame: verify visitor separation, blob exports, reset/expiry and stale tabs, body/storage/rate limits, no external provider calls, and the exact parent frame policy. Check desktop and mobile in a browser. Keep the personal app on its original origin and authentication/storage contracts. Verify real owner-only sign-in separately: synthetic fixtures cannot prove live Google authentication or deployed edge policy.

No public release is implied by this example. Obtain owner approval of the working preview, then deploy the isolated demo first, verify it, and only then enable the parent's public entry. Roll back code/configuration on failure; never restore an old personal database.
