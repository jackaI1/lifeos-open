# Public demo with browser-only storage

The hosted public demo serves static app files. Its application code, SQLite database, files, mock services, drafts and edits run in the visitor's browser. There is no visitor database, API session cookie, signing secret, Durable Object, upload endpoint or cloud AI connection on the public host.

The standalone Node edition remains available. Devotional and Prayer follow Daily photos in both editions; practices are optional by default and the fictional workspace does not seed daily completions. Explicitly completing a practice still works. Existing owner data is not reset by these source changes.

## Build

Use Node24 and the normal locked project dependencies. Run:

```
node tools/build-browser-demo.mjs
node tools/build-hosted-assets.mjs
```

The browser build installs pinned, integrity-checked packages into `.runtime/browser-demo/node_modules`, independently of normal app dependencies. `tools/browser-demo/package-lock.json` records their registry integrity. Generated browser engine, SQLite WASM and schema assets are included under `public/vendor/browser-demo/`.

The staging builder reads `wrangler.public.example.jsonc` by default. For a custom configuration, set `LIFEOS_PUBLIC_CONFIG` to its path. Confirm the exact distinct HTTPS `DEMO_ORIGIN` and `PARENT_ORIGIN` before building. The output `.runtime/hosted/assets` contains rewritten bootstrap HTML and static security headers. It never copies personal records or environment files.

Run Wrangler with `--dry-run` to prepare without publishing. Do not publish before owner preview approval. Active bindings are only `ASSETS` and the two origin values; any database, secret, service or additional binding is rejected.

## Data behavior

API calls are handled by a dedicated browser worker using actual app routes and SQLite WASM. Successful mutations are acknowledged only after IndexedDB commits. Web Locks serialize updates across tabs on the same device. Each browser profile has its own workspace. Browser drafts and recording recovery use a separate stable local namespace.

Media and download requests are served locally by the demo's own service worker. No failed local request falls back to a remote API. The public host rejects API/auth requests and every method other than GET/HEAD without reading the request body. Public hosting has no visitor write storage.

There is no automatic expiry. Data stays in that browser until its site data is cleared or evicted. It does not synchronize between devices or browser profiles. Private browsing may discard data when its window closes; use the existing records export to keep a separate copy. A loaded workspace can save while offline; cold offline startup is not promised. Real connected services are unavailable and AI responses are explicitly simulated.

The private owner app remains on its existing origin, authentication and storage contracts. Public code never runs in the private parent origin. Login is handled by that parent; the public demo has no real OAuth connection.

## Verification and release

Run unit tests, typecheck, lint, privacy checks, browser engine integration tests, and the real local Workers transport test. Check desktop/phone scrolling, edits and reloads, separate browser profiles, two-tab updates, media, and absence of network writes. Keep every fixture scoped and close test resources.

Static assets use CDN asset serving; only root/API/auth fallback routes invoke the small Worker. This removes server-side visitor writes and per-visitor database cost. Static traffic can still consume hosting resources; browser-only storage is not a denial-of-service guarantee. Confirm actual Free hosting entitlement, capacity and supported traffic controls before release, without paid enrollment or a card.

After owner approval, stage the isolated demo first and verify deployed policies, then enable only the personal root frame. Verify real owner-only Google login separately. Roll back code/configuration on failure; never restore or migrate an old personal database.
