# Checking the public boundary

I keep the hosted demo read only on the server. Visitor edits run in the browser
with fictional data. `node --test test/security-headers.test.mjs` tests the actual
Worker, the request handler used by the public host, without a cloud account.

| Finding class | Check and fix |
| --- | --- |
| Script injection | Selenium saves an HTML-looking event title and verifies literal text, no inserted image and no executed handler. DOM text is created with `textContent`. |
| Missing content policy | Worker tests require Content-Security-Policy (CSP), which restricts script sources and forbids objects and foreign forms. |
| Unwanted framing | `frame-ancestors` permits Jack's parent site only. X-Frame-Options cannot express that cross-origin parent and is deliberately absent. |
| Referrer disclosure | `Referrer-Policy: no-referrer` keeps full paths out of other sites' request headers. |
| Content sniffing | `X-Content-Type-Options: nosniff` and explicit content types prevent treating uploaded or static bytes as script. |
| Remote mutation | Every POST, PUT, PATCH and DELETE at the public Worker returns 405. GET requests to its API paths return 403. |
| New passive findings | OWASP ZAP spiders a locally built public container in CI. The report checker fails every medium or high finding absent from the exact reviewed evidence list. |

The scan does not attack the live site, authenticate to private workspaces or
establish that all security problems are absent. Low and informational findings
remain in the uploaded HTML and JSON reports for review. The report checker fails
if the report is missing or invalid. A baseline entry must describe the precise
rule and evidence; it must not suppress an entire class of findings.

The local edition additionally checks Host, Origin, session access and CSRF (a
random value tied to the local service) before accepting a microphone socket or
syllabus request. WebSocket payloads and retained sessions have size limits.
