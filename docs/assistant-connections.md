# Reviewing syllabus dates

I can paste just the part of a syllabus I want turned into a draft schedule.
In the local workspace, **Settings → Connections → Assistant provider and
syllabus review** opens the form. I choose Local or Claude, save the choice,
paste text with explicit dates and times, and choose **Draft events for review**.
The result says which provider answered. Nothing is saved to the calendar until
I choose **Confirm and save these events**. I check every title, timezone and time.

For Local, configure the existing compatible model endpoint with `LLM_API_KEY`,
`LLM_BASE_URL` and `LLM_MODEL` as described in [the notes guide](notes-questions.md).
For an optional Claude connection, set `ANTHROPIC_API_KEY` in the server's
environment, optionally `CLAUDE_MODEL` (default `claude-sonnet-4-5`). I restart
`npm run dev` after changing environment variables. There is no key field in
the page and no key in a database record or returned settings response.

Only the pasted text goes into this request. The feature does not fetch saved
notes, photos or the schedule to send alongside it. Claude uses Anthropic's
Messages API and its `draft_calendar_events` tool to return structured proposals.
A strict schema rejects extra fields, invalid times, reversed intervals and more
than 50 events. Missing keys, HTTP failures, timeouts and invalid tool output
fall back to the configured local model, with a visible reason. If that model
also fails, the page shows an error and saves no events. This connection is
separate from the public demo's scripted example conversations.

`node --test test/syllabus.test.mjs` runs six mocked-client checks for the exact
outbound context, tool use, HTTP errors, timeout, absent key, invalid output and
local failure. These do not claim to make a paid Claude call. The implementation
follows the [Anthropic tool-use contract](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).
