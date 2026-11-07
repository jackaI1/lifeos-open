# A fictional review desk

I wanted to learn how to make a small review workflow in a low-code builder,
where I choose form and table components instead of writing every screen.
I kept it beside LifeOS with fictional deliverables, a source-citation table,
and a water/sewer asset registry. It is a learning example, not a record of
work for a customer or a medical tool.

## Try the review forms

On a machine with Docker, set these local environment variables. Generate your
own passwords and keys; the CI values are disposable examples only.

```sh
export BB_ADMIN_USER_EMAIL=fictional@example.com
export BB_ADMIN_USER_PASSWORD=replace-with-a-local-password
export BUDIBASE_JWT_SECRET=replace-with-a-random-secret
export BUDIBASE_INTERNAL_KEY=replace-with-a-random-key
export BUDIBASE_ENCRYPTION_KEY=replace-with-a-random-key
export BUDIBASE_REDIS_PASSWORD=replace-with-a-random-password
docker compose -p internal-desk -f compose.internal-desk.yaml up -d
# Wait for http://127.0.0.1:10000/api/global/health to respond.
python -m pip install requests
python tools/internal-desk/budibase.py
```

Open `http://127.0.0.1:10000`, sign in with the local account, and open the
**LifeOS fictional review desk** workspace. The provisioning script creates
real Budibase tables, a review form, a filtered clean-up queue, a read-only audit
screen, and the five source citations from the PDF example. The row-update
automation copies each reviewed title, status and source row id to the audit
table. The form does not edit audit rows; an administrator can still change
platform data, so this is not a tamper-proof compliance log.

`node tools/internal-desk/budibase-browser.mjs` drives the published form with
Playwright, edits a fictional title, waits for the real audit automation, checks
the citation count and filtered queue, and saves a screenshot. The workflow runs
this against the actual pinned Budibase container on Linux. This setup uses the
[public API](https://docs.budibase.com/docs/public-api) for data and the release's
builder API for screens. `budibase.py` is the reproducible app definition.
It stores only generated ids in `.runtime`, never its API key or login cookie.

Stop and remove this disposable example, including its fictional data:

```sh
docker compose -p internal-desk -f compose.internal-desk.yaml down --volumes
```

## Relational reports

```sh
node tools/internal-desk/registry.mjs
node --test test/internal-desk.test.mjs
```

This creates `.runtime/internal-desk/registry.sqlite` and `asset-report.csv`,
which I can open in Excel. SQLite is an embedded relational database. Like an
Access database, this example has linked tables, required values, primary and
foreign keys, unique asset tags, constraints and saved queries. The
`asset_inspection_report` view joins water/sewer assets to their latest
inspection. `cleanup_queue` lists unfinished deliverables needing clean-up.
A review transaction adds a review, changes the status and creates an append-only
audit entry. Tests reject orphan references, invalid condition scores, duplicate
tags and attempts to change the audit. These fictional records are separate
from my workspace database and the Budibase storage.

## Reviewing a PDF form

I made [a blank form](../samples/forms/blank.pdf) and
[a filled fictional example](../samples/forms/filled.pdf). The interactive PDF
contains an AcroForm dictionary, the canonical list of fields, and Widget
annotations, the visible field boxes on its page. The tool reads both and
rejects unknown, duplicate or orphaned fields. It reports text, checkbox and
signature field types, their references and rectangles.

```sh
node tools/forms/generate.ts
node --test test/form-fields.test.mjs
# Optional storage of rules, mappings, values and citations in PostgreSQL:
FORM_DATABASE_URL=postgresql://user:password@localhost/forms node tools/forms/generate.ts
```

Five allowed fields copy explicitly sourced fictional chart values. The
[field map](../samples/forms/field-map.json) names each JSON source path and the
rule behind it. Diagnosis and signature stay blank for a physician. A filled
physician-only input is rejected before a new PDF is written. PostgreSQL adds a
constraint that forbids storing a value or citation for those fields. Text and
checkbox appearance streams, instructions for drawing their saved values, are
regenerated; the file remains interactive. Tests reopen the canonical fields,
check appearances, compare the committed sample's values and exercise the real
database constraint in CI. I also rendered and inspected the sample with Poppler.
This tool accepts the self-made sample, not arbitrary clinical forms or charts.
