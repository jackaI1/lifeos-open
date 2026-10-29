# Slide dock race repair

Complete immutable original: `.lifeos/requests/20261029-slide-dock-race-full-original-003.txt`
SHA-256: `c5ca2f814843f6fe27a98b5b4b4645eaf01eaa099d22ce889e11080b54bc4309`

Initial scope receipt: `.lifeos/requests/20261029-slide-dock-race-original-001.txt`
SHA-256: `60e25dd6f7237e995897b2777aa6da5ca8d292410255a7db7d4e07c7d7bcdd46`

Additional immutable instruction: `.lifeos/requests/20261029-slide-dock-race-steering-002.txt`
SHA-256: `3ad2a66f0b928cbf13b329ad40fff3f15b40033141ff743b73b202a66d32b0bf`

- PASS: deterministically reproduced two docks by holding the first mount across a hash-route change.
- PASS: pending mounts are shared; stale route teardown cannot detach the current host.
- PASS: late slide creation starts hidden; suspended slides stay hidden across viewport changes and return as one dock.
- PASS: Today behavior and navigation/custom-theme merge retained.
- PASS: 153 unit/API tests, 7 browser-service tests, build, lint, typecheck, privacy, 49 smoke checks, 60 desktop/phone browser cases.
- PASS: five full smoke passes at six-times CPU throttling, each 49/49, with browsers/pages and fixture ports verified closed.
- Pending: green PR and exact merge-commit main CI.
- Pending: fresh-clone assets-only demo deployment and live verification, including navigation placement and Custom theme.
- PASS: read-only comparison found the same concurrent-mount race in the private branch; no private modification or deployment.
- Pending: final owned-resource cleanup and metadata verification.
