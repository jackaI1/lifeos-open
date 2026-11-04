# Working agreement

## Cadence
- Sprint length: 2 weeks, tracked as a GitHub milestone (`Sprint N`).
- Sprint planning: day 1. Pick stories from the Backlog up to the sprint capacity, write the goal in `sprint-N.md`.
- Check-in: asynchronous, a comment on the story when its state changes. No daily meeting.
- Sprint review and retrospective: last day, using the template in this folder.

## Board columns
| Column | Meaning |
| --- | --- |
| Backlog | Refined story with acceptance criteria and points, not committed |
| Sprint | Committed to the current milestone |
| In progress | A branch exists; at most 2 stories per person at once |
| Review | PR open, CI running or awaiting review |
| Done | PR merged to `main`, Definition of Done met, issue closed |

## Stories and estimates
- Every story uses the Feature or Bug issue template: a story, testable acceptance criteria, story points, priority.
- Points are relative effort including tests and docs. 1 = under an hour, 2 = a short session, 3 = about half a day, 5 = about a day, 8 = most of two days. Anything above 8 is split.
- Labels: `story`, `bug`, `skill` (portfolio skill work), `points:N`, `priority:*`.

## Working rules
- One story, one branch, one PR; the PR body says `Closes #N` so the board moves automatically.
- Branch names: `skills/<topic>`, `feat/<topic>`, `fix/<topic>`.
- Never force-push `main`. Merge only when CI is green and the Definition of Done is met.
- Scope changes mid-sprint: add a new story to the Backlog; swap in only by removing something of equal size.
- Fictional fixtures only; no credentials, personal records or job-application data in issues, PRs or commits.
- Anything needing a human (cloud accounts, Microsoft sign-in) is called out in the story's acceptance criteria and marks the story blocked rather than faked.
