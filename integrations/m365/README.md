# Microsoft 365 integration (optional)

Pushes LifeOS coursework tasks to a **SharePoint list** through **Microsoft Graph**, and ships a
**Power Automate flow** that sends a Teams and Outlook reminder when a synced item is due tomorrow.

LifeOS keeps working without any of this. Nothing here runs unless you configure it and run a command.

```
LifeOS SQLite ──read-only──▶ sync.ts ──Graph v1.0──▶ SharePoint list "LifeOS Tasks"
                                                           │
                          Power Automate (daily 08:00) ◀───┘──▶ Teams + Outlook reminder
```

## What is shared

Only these fields leave your machine, and only when you run `sync`:
title, course code and name, due date, due time, status and estimated minutes.
Task notes, next steps, source links and every other LifeOS record are never read.
The database is opened read-only, so a sync cannot change your workspace.
Sync is one-way (LifeOS → SharePoint). Edits made in SharePoint are overwritten when the LifeOS task
changes, or on `sync --force`.

## Files

| Path | Purpose |
| --- | --- |
| `src/graph-client.ts` | Typed Graph client: bearer auth, paging, retry with exponential backoff and jitter, `Retry-After`, one token refresh on 401 |
| `src/graph-types.ts` | Typed Graph resources used (sites, lists, columns, items) |
| `src/auth.ts` | MSAL device-code sign-in and silent renewal; token cache saved with mode 0600 |
| `src/sync.ts`, `src/mapping.ts` | Idempotent list sync and the LifeOS → SharePoint field mapping |
| `src/lifeos-source.ts` | Read-only reader for the LifeOS SQLite workspace |
| `src/cli.ts` | `npm run m365 -- login`, `whoami`, `sync`, `logout` |
| `flow/definition.json` | The Power Automate flow definition (readable, diffable) |
| `flow/LifeOSDueTomorrowReminder_1_0_0_0.zip` | The same flow as an importable solution package |
| `flow/pack.ts` | Rebuilds the zip: `npm run m365:pack-flow` |
| `test/` | Mocked-Graph tests, run by `npm test` |

## Microsoft Graph permissions

Delegated permissions only (the app acts as the signed-in user; there is no client secret and no
app-only access):

| Permission | Why | Admin consent |
| --- | --- | --- |
| `Sites.ReadWrite.All` | Find the site, create the list and its columns, create/update/delete list items | Not required by default; a tenant can restrict user consent |
| `User.Read` | `whoami` and sign-in | No |

`offline_access` is added by MSAL so the refresh token can renew silently. Use a dedicated site: the
permission is tenant-wide in what it *can* reach, but the code only touches the site in `M365_SITE_URL`.

The flow uses its own connections (SharePoint, Microsoft Teams, Office 365 Outlook), which you
authorise in Power Automate when you import it. They need no Graph app registration.

## Setup

### 1. Choose a tenant

Use your **UW Microsoft 365 account** if its tenant lets you register apps and consent to
`Sites.ReadWrite.All`. University tenants often block both. If you see *"Need admin approval"* or cannot
open App registrations, use a **free Microsoft 365 developer tenant** instead
(<https://developer.microsoft.com/microsoft-365/dev-program>; sandbox eligibility changes, so check the
program page). The developer tenant includes SharePoint, Teams and Outlook, which is everything this
integration needs. Nothing in the code depends on which tenant you pick.

### 2. Register an app in Microsoft Entra

1. Entra admin center → **App registrations → New registration**.
2. Name `LifeOS sync`; supported account types: **this organizational directory only**.
3. **Authentication → Advanced settings → Allow public client flows = Yes** (device-code sign-in needs this).
4. **API permissions → Add → Microsoft Graph → Delegated**: `Sites.ReadWrite.All`, `User.Read`.
   Grant consent if your account is allowed to; otherwise you will be asked at first sign-in.
5. Copy the **Application (client) ID** and **Directory (tenant) ID** (neither is a secret).

### 3. Create a SharePoint site

Create a team or communication site, for example `LifeOS`. Its URL looks like
`https://YOUR-TENANT.sharepoint.com/sites/LifeOS`.

### 4. Configure and sign in

Add to `.env` (git-ignored; see `.env.example`):

```
M365_CLIENT_ID=<application id>
M365_TENANT_ID=<directory id>
M365_SITE_URL=https://YOUR-TENANT.sharepoint.com/sites/LifeOS
```

```
npm ci
npm run m365 -- login      # prints a code; open https://microsoft.com/devicelogin and enter it
npm run m365 -- whoami
npm run m365 -- sync --dry-run
npm run m365 -- sync
```

The token cache is stored at `.local/m365-token-cache.json` (override with `M365_TOKEN_CACHE`).
`npm run m365 -- logout` deletes it.

### `sync` options

* `--dry-run` prints what would be created, updated or deleted and writes nothing.
* `--prune` also deletes list items whose LifeOS task no longer exists. Without it they are only counted
  as `orphaned`. Items you add by hand in SharePoint (no `LifeOSId`) are never touched.
* `--force` rewrites every item even if nothing changed in LifeOS.

Runs are idempotent. Each item carries the LifeOS task id (`LifeOSId`) and a hash of its synced fields
(`SyncHash`), so a second run with no changes sends no writes, and a lost or new machine adopts the
existing items instead of duplicating them.

### Retry behaviour

`429` and `503` are retried for every method, honouring `Retry-After`. `502`, `504` and connection errors
are retried only for idempotent calls (GET, PATCH, PUT, DELETE), because a repeated POST could create a
duplicate. Waits are `random(0, min(30 s, 0.5 s × 2^attempt))`, never shorter than `Retry-After`, for up to
four retries. A `401` triggers one forced token refresh. Pagination links to any host other than Graph are
refused so the bearer token cannot be sent elsewhere.

## Power Automate reminder flow

**What it does:** every day at 08:00 (Eastern Time by default) it reads the list, keeps items whose `DueDate`
is tomorrow and whose status is not Completed or Archived, and for each one posts a Teams message from
*Flow bot* and sends an Outlook email to you.

### Import

1. Run a sync first so the `LifeOS Tasks` list exists.
2. <https://make.powerautomate.com> → choose your environment → **Solutions → Import solution**.
3. Browse to `integrations/m365/flow/LifeOSDueTomorrowReminder_1_0_0_0.zip` → **Next**.
4. When asked, create or select a connection for **SharePoint**, **Microsoft Teams** and
   **Office 365 Outlook** → **Import**.
5. Open the flow *LifeOS due-tomorrow reminder* and edit the **Settings** step (the only values to change):
   `siteUrl`, `listName`, `recipientEmail`, and `timeZone` (a Windows time zone name such as
   `Eastern Standard Time`). Also change the trigger's time zone if you are not in Eastern Time.
6. **Save**, **Turn on**, then **Test → Manually** to check it. The flow imports switched off.

Solution import needs a Power Platform environment with Dataverse. If yours has none (a plain
"Default" or developer tenant without it), create the flow by hand instead: **Create → Scheduled cloud
flow**, then rebuild the steps from `flow/definition.json`. The step names and expressions map one to one.
To remove Teams or Outlook, delete that action inside *For each due item*.

### Test it end to end

Sync, then in SharePoint set one item's **Due date** to tomorrow and **Status** to *Not started*, and run
the flow manually. You should receive both messages.

## Development

```
npm test                    # includes integrations/m365/test with a mocked Graph
npm run typecheck
npm run m365:pack-flow      # after editing flow/definition.json; a test fails if the zip is stale
```

The tests use an in-memory stand-in for Graph, so they run offline and need no Microsoft account.

## Verification status

Covered by automated tests: the Graph client (retry, backoff, paging, auth refresh), device-code and
silent-token logic against a fake MSAL app, the sync (create, update, no-op, prune, dry-run, adopt,
columns), the mapping, the read-only LifeOS reader, and the flow definition and package structure.

Not covered by tests: the live calls to Microsoft 365 and the Power Automate import. Those need a signed-in
account; see the end-to-end run notes in the pull request.
