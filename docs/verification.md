# Checking a local checkout

Use fictional fixtures and a separate database for checks. No private workspace
or provider account is needed for the default suite.

## Source and API checks

```sh
npm ci
npm run build
npm test
npm run lint
npm run typecheck
npm run privacy
```

The tests cover storage, API requests, backup/restore, revisions, configuration
and controlled assistant responses. CI runs the service tests against SQLite and
PostgreSQL. [Database notes](postgresql.md) explain the separate PostgreSQL test
configuration. These tests do not establish the quality of a live provider.

## Browser checks

```sh
npx playwright install chromium
npm run test:smoke
npm run test:e2e
```

Smoke checks use the built application. End-to-end tests use fictional databases,
controlled audio and local provider fixtures at desktop and phone sizes. They
check visible results, persistence, console errors and failed requests. The
scripts own their browser contexts and temporary servers and close them on exit.
Do not reuse a personal workspace database for these tests.

For the separate browser-only engine, run:

```sh
node tools/build-browser-demo.mjs --test-bundle
node --test src/browser/browser-service.test.mjs
```

The [local reference](local-workspace.md#testing) lists the test files and
configuration. [The demo audit](demo-audit-2026-10-22.md) records a past audit of
fictional demo paths; it is not a claim that external accounts were exercised.
