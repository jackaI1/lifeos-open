# Fictional demo audit — October 22, 2026

The main demo workflows passed the checks below. This is evidence about the tested paths, not a guarantee that every possible device, file or action works.

## What changed

- Demo chat boxes are gray and read-only. Empty boxes say: “No AI is connected for this demo, try a question instead.” Send and photo attachment controls cannot submit an arbitrary question.
- “Try a question” buttons send their question and show an authored response. Personal assistant, academic adviser, finances, lecture tutor, project helper, Support and cooking help are covered.
- The two schedule-changing examples make their own validated local change and offer Undo. Other pending proposals are left alone. Replies describe whether the change was applied or undone.
- Cooking examples now show completed, distinct answers with the exact saved recipe excerpt, without requiring a second status check.
- A fast double-click cannot accidentally send a second example. Earlier text and photo-only drafts are preserved in their original chat before an example starts another chat.
- Connected-model chat behavior is preserved. No real model or paid service is used by the fictional demo.

## Checks completed

- 23 routes at desktop and phone widths: 46 passing layout/navigation checks, including Today, Academics subpages, projects, Exercise, Reminders/cooking, Email, Finances, Notes, Friends, Journal/templates, Photos, Devotional, Prayer, Support and Settings/deleted records.
- Calendar create/edit/validation, expenses/budget totals, reminders, run logging, Notes/folders, two Journal revisions, partial devotional writing, projects/steps and focus timers checked in the real browser-only engine. Saved changes were verified after actual document reloads.
- All authored chat examples clicked; phone placeholder fit checked. Schedule change and Undo checked. Cooking answers checked without a manual status refresh.
- 46 additional desktop/phone core workflow tests passed against an isolated local test service. These are separate from the browser-only checks.
- 136 unit/integration tests passed, including browser database save/reopen, exact cooking receipts, repeat requests, older drafts and connected-model separation.
- Preview login boundary tests passed. Code lint and type checks passed. Source privacy scan found no flagged private paths, credentials, owner email or other configured patterns in the publishable source.
- The isolated browser observed zero HTTP application API requests: demo edits stayed in browser storage. External navigation was limited to the explicitly selected source/repository links.
- An independent code review found the double-click and photo-only-draft cases above; both have regression tests and are fixed.

## Limits to understand

- These are authored examples, not a connected AI. Arbitrary tutoring, interpreting handwriting/uploads, generating study material from arbitrary documents and parsing arbitrary messages are not established AI capabilities of this demo. Some older mock tools use canned fictional results; they must not be mistaken for real analysis.
- Email remains a fictional local draft experience; no message is sent. Real calendar/account sync, push notification delivery, microphones/cameras, recording uploads and physical Apple Pencil/iPhone behavior were not tested with personal accounts or private records.
- Operation World is a separate public feed and needs internet. External repository access depends on each repository's visibility.
- Browser storage persists on that browser/device. Clearing site data, private browsing or storage eviction can remove local demo edits; there is no server backup or cross-device sync.
- The visual detector flagged a pre-existing thin accent on proposal rows. It was outside the changed composer styling and retained as the existing state indicator; no new deterministic design finding was introduced by the gray composers.

The personal LifeOS site, beta, original records, normal workers and queues are outside this change. The owner-only preview remains behind Google sign-in; anonymous publication still needs the owner's separate approval.
