# Migrating a view to React + TypeScript

LifeOS's browser app is plain ES modules in `public/`. Each route is a module in
`public/modules/<view>.js` that exports `mount(root, ctx)` and returns
`{destroy}`. A React view keeps that contract, so the router in `public/app.js`
doesn't change and views can be migrated one at a time.

The **Finances (budget) view** was the first one migrated. It's the reference
implementation for the steps below.

| Piece | Path |
|---|---|
| Thin legacy entry (route module) | [`public/modules/finances.js`](../public/modules/finances.js) |
| React entry, `mountFinances(root, ctx)` | [`src/frontend/react/finances/index.tsx`](../src/frontend/react/finances/index.tsx) |
| View and components | [`src/frontend/react/finances/`](../src/frontend/react/finances/) |
| Data-fetching hook | [`src/frontend/react/finances/useFinances.ts`](../src/frontend/react/finances/useFinances.ts) |
| Shell adapters (icons, popovers, dialog, busy button) | [`src/frontend/react/shared/shell-bridge.tsx`](../src/frontend/react/shared/shell-bridge.tsx) |
| Typed contract for `public/` modules | [`src/frontend/react/shell.d.ts`](../src/frontend/react/shell.d.ts), [`context.ts`](../src/frontend/react/context.ts) |
| Tests (Vitest + React Testing Library) | `src/frontend/react/**/*.test.tsx`, [`vitest.config.mjs`](../vitest.config.mjs) |
| Build | [`tools/build.mjs`](../tools/build.mjs), output in `public/react/` |

## How it fits together

```text
public/app.js ──import()──▶ public/modules/finances.js        (unchanged router contract)
                                │ import
                                ▼
                         public/react/finances.mjs             (esbuild bundle, committed)
                                │ import "../ui.js", "../quiet-controls.js", …
                                ▼
                         public/*.js shell modules             (same live instances as the rest of the app)
```

- **Source** lives in `src/frontend/react/` as `.ts`/`.tsx` and is strictly
  typechecked by `src/frontend/react/tsconfig.json` (`npm run typecheck`).
- **Shell imports** use the `@shell/<file>.js` specifier. `tools/build.mjs`
  marks these external and rewrites them to `../<file>.js`. The bundle never
  copies `ui.js` or `quiet-controls.js`, and the shared `#dialog`, `#toast` and
  popover state stay single instances. `shell.d.ts` declares only the functions
  React code uses, so the typed surface stays small.
- **Bundling** uses the esbuild already in the repo (no extra build tool):
  production React, minified, ES2022, code splitting on. Once a second view has
  an entry, React moves into a shared `public/react/chunks/` file and every
  view reuses it.
- **Committed output.** The server serves `public/` without a transform step
  (`npm run dev` has no build), so `public/react/*.mjs` is committed like
  `public/vendor/document-runtime.mjs`. CI rebuilds it and fails if the
  committed file is stale.
- **Lazy by default.** The bundle is only fetched when the route opens. Other
  pages don't download React.

## Recipe for the next view

1. **Pick a view with clear edges.** It should read one or two API endpoints and
   write through `ctx.outbox.submit`. It shouldn't own another view's DOM.
2. **Type the API response** in `src/frontend/react/<view>/types.ts` from the
   route in `src/cloud/`.
3. **Write a data hook** modelled on `useFinances`:
   - call `ctx.request(...)` and `ctx.outbox.submit(...)` **as methods**. The
     shell objects rely on `this`, so don't destructure them;
   - keep the previous data while a new request is in flight (no loading flash);
   - discard out-of-order responses with a generation counter;
   - don't set state after unmount.
4. **Port the markup.** Copy the legacy class names and element structure so
   the existing CSS applies unchanged. Use the shell bridge instead of rebuilding
   shell controls:
   - `<ControlIcon name>` / `<IconButton>`: the same stroke icons as `quiet-controls.js`;
   - `<ShellDisclosure>`: the shell's popover (hover, focus, portal placement,
     Escape and outside click) with React content portalled into it;
   - `useShellDialog()`: opens React content in the app's single `<dialog id="dialog">`;
     render `dialog.element` once inside the view;
   - `<BusyButton>`: "Working…", disabled while pending, errors go to the toast;
   - `<LegacyNode create={() => legacyFactory()}>`: hosts any other legacy DOM node.
     It renders `span.react-legacy-slot` (`display: contents`) so flex layouts
     don't change.
5. **Respect the page heading contract.** After mounting, `public/app.js`
   appends search, timer and status controls to `.page-heading > .actions`.
   Render React-owned actions unconditionally and first, so React never inserts
   after shell-owned nodes. Change the heading's `key` when its actions first
   appear (Finances does this when data loads), so the shell decorates a fresh
   element. A test covers this.
6. **Mount and resolve after the first load.** The router awaits `mount` before
   it settles scroll position and adds app tools:

   ```tsx
   export async function mountX(root: HTMLElement, ctx: ShellContext) {
     const host = document.createElement('div');
     host.className = 'x-page';
     root.replaceChildren(host);
     const reactRoot = createRoot(host);
     await new Promise<void>(settled => reactRoot.render(<XView ctx={ctx} onSettled={settled} />));
     return {destroy: () => reactRoot.unmount()};
   }
   ```

   Then reduce `public/modules/x.js` to an import of `../react/x.mjs` and add the
   entry to `entryPoints` in `tools/build.mjs`.
7. **Test with React Testing Library.** Vitest aliases `@shell` to the real
   `public/` modules, so tests exercise the real dialog, toast and popover code
   in jsdom. Fake only the network (`ctx.request`, `ctx.outbox`) and modules
   that pull in unrelated pages (for example `assistant-chat.js`). Make fake
   shell methods depend on `this`, like the real ones; this caught a real
   unbound-method bug during the Finances migration. Use `test/finance-fixture.ts`
   as a template.
8. **Verify in a browser.** Run the existing e2e spec for the view
   (`E2E_FOCUS='^13-' npm run test:e2e` for Finances) and compare screenshots
   before and after. For Finances, desktop, mobile, Add-transaction and
   Categorize screenshots were pixel-identical to the legacy view.

## Finances migration notes

- **Behaviour kept:** the period switcher (buttons, swipe, `?period=`), the
  allowance cards, the reconciliation inbox, transaction filters, add and
  recategorize with offline outbox handling and undo, the forecast, the
  allowance preview, protected commitments, and both JSON downloads.
- **Fixed during the migration:**
  - The options menu item said "Budget through September 2027" (hard-coded),
    while the dialog it opened used the real budget horizon. The label now
    comes from the data.
  - A failed refresh after the first load used to go to a detached node and
    never appeared. It now shows an inline notice with Retry.
  - Refresh callbacks use the current selection even when a write from an
    earlier period finishes later. Retained allowance totals keep their own
    period label until the next request succeeds, including after an error.
- **Removed:** `public/finance-tools.js`. Its dialogs and inbox are now React
  components. The pure model (`finance-model.js`, `finance-preview.js`) stays
  shared JavaScript, used by both the server-side snapshot and the React view.
- **Size:** `public/react/finances.mjs` is about 236 KiB minified and 73 KiB
  gzip. About 200 KiB of that is `react-dom`; the view code is about 15 KiB.
  It's loaded only on the Finances route.
