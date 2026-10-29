# Time format preference

Scope: Settings > Theme > Time format. Two existing appearance keys, label only.
Default: 24-hour. Preference: settings/preferences.timeFormat, with a display cache alongside Theme.
Shared clock formatter covers wall times and timestamp displays. Canonical native inputs, stored dates, payloads, calendar calculations and elapsed durations retain their existing formats. Custom clock parsing accepts 24-hour and AM/PM text.

Implementation brief: `.lifeos/requests/2026-10-28-time-format-public.txt`
SHA-256: `827287efa77765db75dd896b2c42057010b2ca69a38f46d1a2535950cf73cf72`

Verification:
- PASS: 161 unit/API cases and 7 browser-service cases.
- PASS: server/editor build, browser engine build, lint, typecheck and privacy.
- PASS: 49 smoke cases.
- The full 62-case browser campaign initially passed 57 cases. Four revision checks expected the old locale timestamp, and the new desktop keyboard check selected a hidden Settings section. Exact timestamp expectations now use the requested default clock format; section navigation uses the actual active layout. The six affected desktop/phone cases pass, preserving the restoration assertions.
- PASS: clock preference application and reload persistence, canonical native inputs, keyboard switching, full AM/PM labels and responsive clock geometry.
- PASS: mechanical design scan, no findings.

No data migration. Existing authored content is preserved verbatim.
