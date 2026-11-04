# Public demo product analytics (GA4 + GTM)

LifeOS has an optional Google Analytics 4 integration loaded through Google Tag Manager.
It is enabled **only in the generated public demo shell**, using build-time identifiers.
The checked-in shell and standalone/private app do not load it, even when those environment
variables are set. No real Google identifiers are committed. Until Jack creates the property
and container and rebuilds the public demo, analytics stays off and there is no consent banner.

## Five-minute setup

1. In [Google Analytics](https://analytics.google.com/), create a GA4 property called
   **LifeOS public demo** (Admin → Create → Property), then a **Web** data stream for the
   actual public demo origin. Copy its **Measurement ID**, `G-…`. Turn **Enhanced measurement
   off** for this stream, including history-based page views, form interactions, site search,
   downloads, outbound links and scrolls. Keep Google signals, user-provided data collection,
   advertising personalization and Ads links off. This avoids Google's automatic collection
   of URLs, search text and form/link metadata outside the taxonomy below.
2. In [Google Tag Manager](https://tagmanager.google.com/), create an account if needed and
   a **Web** container called **LifeOS public demo**. Copy its **Container ID**, `GTM-…`.
3. In GTM **Admin → Import Container**, select
   [`analytics/gtm/lifeos-demo-container.json`](../analytics/gtm/lifeos-demo-container.json),
   choose a new workspace, and **Merge** with renamed conflicting tags/variables. Review
   the import preview, then **Confirm**. The account/container numbers in the export are
   placeholders; the import targets the container you selected. The Measurement ID is read
   from a dataLayer variable, so no tag needs an ID pasted into its settings. Submit and
   publish the container with a version name such as `LifeOS consented product events`.
4. Paste the real IDs into the **public demo build environment**, not the private app's
   runtime bindings. Example (these placeholders intentionally leave analytics disabled):

   ```sh
   npm run build
   node tools/build-browser-demo.mjs
   LIFEOS_GTM_ID=GTM-XXXXXXX LIFEOS_GA4_MEASUREMENT_ID=G-XXXXXXXXXX node tools/build-hosted-assets.mjs
   ```

   Replace both placeholders with the IDs from steps 1–2. For CI hosting, add those two
   named environment variables to its public demo asset-build step. Deploy the generated
   `.runtime/hosted/assets` using the existing [public hosting process](../HOSTED_DEMO.md).
   Rebuild whenever an ID changes. No additional Worker binding is accepted or needed.
5. On the public demo, verify zero Google requests before choosing **Allow analytics**.
   After acceptance, navigate and add a fictional task/budget entry. Confirm the requests
   in DevTools Network and events in GA4 **Realtime**. **Analytics: on → No thanks** must
   stop subsequent events; reload to confirm the stored decline. GPC or DNT enabled means
   no banner and no Google requests. A missing/malformed/placeholder GTM ID disables the
   integration. Supply both real IDs for the provided container; GTM alone is supported only
   for a separately configured container with its own measurement destination.

The application-summary claim about using live GA4/GTM is ready after this setup and the
Realtime check. Code integration and automated tests alone do not prove live collection.

## Consent and privacy boundary

The implementation follows [basic Consent Mode](https://developers.google.com/tag-platform/security/concepts/consent-mode):
no Google script or analytics request is initiated before an affirmative choice. Consent Mode
v2 defaults `analytics_storage`, `ad_storage`, `ad_user_data` and `ad_personalization` to denied;
acceptance grants only `analytics_storage`. GPC and DNT override a previously stored grant.
The choice is stored under `lifeos-analytics-consent` in this demo origin's real localStorage,
outside the application's workspace/draft namespace. Storage failure means a page-only choice.
The non-modal banner leaves the app usable after either choice and exposes a preference button.

Withdrawal immediately stops application dataLayer events, sets Google's
`ga-disable-G-…` flag when a measurement ID is configured, and updates consent to denied.
It does not erase events already sent or revoke an in-flight request. Existing Google cookies
may remain until cleared/expired. Do not add unrelated tags to this container: already loaded
third-party scripts cannot be removed from a running page by this module. Google scripts can
emit standard session/engagement metadata after acceptance; the table describes LifeOS events.

Only fixed enums and canonical per-view URLs leave the application's analytics module. No
record IDs, task titles, note content, names, merchants, amounts, dates, real URL query strings,
raw hashes or document titles are sent. A runtime allowlist rebuilds every payload, including
calls from untyped JavaScript. GA4 automatically uses network/device metadata and, after
consent, analytics cookies/client identifiers; this integration does not promise anonymity.
The GA4 configuration and every event tag override page location/title and blank the referrer.
The Google tag suppresses automatic page views and advertising signals. Keep Enhanced
measurement disabled in the GA4 property as described above.

## Event taxonomy

| dataLayer event | GA4 event | Allowed parameters / meaning |
| --- | --- | --- |
| `view_changed` | `page_view` | `view`, `previous_view`, canonical `page_location`, fixed `page_title` |
| `item_created` | `item_created` | `item_type`; successful PUT with version 0 |
| `item_updated` | `item_updated` | `item_type`; successful PUT of an existing record |
| `budget_entry_added` | `budget_entry_added` | No custom parameters; successful budget transaction POST |
| `feature_used` | `feature_used` | `feature`; successful allowlisted action POST |
| `consent_changed` | `consent_changed` | `analytics=granted`; emitted only after opting in |

Views: `today`, `school`, `tickets`, `exercise`, `reminders`, `finances`, `notes`,
`photos`, `support`, `settings`, `email`. The legacy `meals` route maps to `reminders`.
All other routes, including devotional, prayer, journal and friends, collapse to `other`.
`previous_view` may also be `none`. Repeated routes within the same bucket do not emit again;
acceptance reports the current view once. Subviews and record-specific query parameters are ignored.

Item types: `task`, `course`, `project`, `meal`, `grocery`, `coursework`, `run`, `coop-role`.
Features: `task_progress`, `time_logged`, `reminder_saved`, `schedule_entry`.
Unlisted record kinds/actions, failed writes, reads and foreign-origin requests are ignored.
Events count successful observed API calls, not unique humans or deduplicated business records.

For example, adding a task pushes `{event: 'item_created', item_type: 'task'}`. It never
pushes the task body. A view location is `https://PUBLIC-DEMO-ORIGIN/#school` regardless of
the actual query/hash details. Other event tags inherit the last safe page context.

## GTM container inventory

| Component | Configuration |
| --- | --- |
| `GA4 - Google tag (config)` | Google tag, Initialization – All Pages; tag ID from `DLV - ga4_measurement_id`; automatic page views and advertising signals off |
| `GA4 Event - …` (six tags) | One tag per taxonomy event; `view_changed` maps to `page_view`; others keep their event name |
| `CE - …` (six triggers) | Exact-match Custom Event triggers for the six dataLayer event names |
| `DLV - …` (eight variables) | Version 2 Data Layer Variables for `ga4_measurement_id`, `view`, `previous_view`, `page_location`, `page_title`, `item_type`, `feature`, `analytics`; page metadata is shared across event tags |
| Built-in `Event` | Used in the custom event trigger filters |
| Consent | All seven Google tags additionally require `analytics_storage` |

There are eight data-layer variables. There is no Custom HTML tag, Custom JavaScript variable,
click/form/history trigger, advertising tag, user ID or user property. No GTM noscript iframe is
included, since it would contact Google without an affirmative JavaScript consent choice.

For reports, optionally register event-scoped custom dimensions `view`, `previous_view`,
`item_type`, `feature` and `analytics` under GA4 Admin → Custom definitions. This is not
required for collection. Do not register personal content or enable automatic form measurement.

## Implementation and verification

- `src/analytics/`: typed event contract, runtime payload allowlist, consent gate, banner and observers.
- `public/demo-bootstrap.js`: imports the module only when a hosted build injects its meta tag.
  The demo normally rejects foreign fetches. While consent is granted, only HTTPS GET/POST
  `/g/collect` requests to `www`/`regionN` hosts under `google-analytics.com` or
  `analytics.google.com` use captured native fetch, with credentials/referrer omitted.
  All application API writes still use the local transport.
- `tools/build-hosted-assets.mjs`: reads `LIFEOS_GTM_ID` and `LIFEOS_GA4_MEASUREMENT_ID`,
  validates identifiers, and injects meta tags into generated demo HTML only.
- `src/hosted/worker.ts`: allows GTM/GA4 hosts in CSP only for a configured demo shell.
  Private/local policies stay unchanged. Scripts remain external; no `unsafe-inline` or
  general `unsafe-eval` permission is added. GTM Preview may require additional hosts;
  use DevTools/Realtime for production verification without relaxing this policy.
- `test/analytics.test.mjs`: consent, persistence, privacy signals, typed module behavior,
  safe requests/routes, build isolation, CSP, and container reference consistency.
- `tools/analytics-browser.test.mjs`: actual browser banner, reload, withdrawal, GPC and
  absent-configuration checks with Google requests intercepted (no live analytics traffic).

Run `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run privacy`,
then `node --test tools/analytics-browser.test.mjs`. Browser tests require Playwright Chromium.
The tests validate the module and export locally; importing/publishing the container and checking
live collection still require the owner's Google accounts.

Google references: [consent setup](https://developers.google.com/tag-platform/security/guides/consent),
[GA4 configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config),
[GTM CSP requirements](https://developers.google.com/tag-platform/security/guides/csp).
