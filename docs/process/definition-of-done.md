# Definition of Done

A story is Done only when all of these hold:

1. Every acceptance criterion on the issue is met and ticked in the PR description.
2. `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` and `npm run privacy` pass; CI is green on the PR.
3. New or changed behaviour has automated tests; bugs have a regression test that failed before the fix.
4. Existing features still work (smoke tests pass).
5. User-facing or operational behaviour is documented (README, `docs/`, or inline help).
6. New integrations have an offline substitute and explicit configuration (see CONTRIBUTING.md).
7. No secrets, personal records or job-application data in the diff or the PR discussion.
8. The PR is linked to the issue, merged to `main` (never force-pushed), and the issue is closed.
9. Stories that depend on external accounts are only Done when verified end to end, otherwise they are marked blocked with the remaining step written down.
