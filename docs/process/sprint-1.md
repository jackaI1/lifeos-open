# Sprint 1 plan

Milestone: [Sprint 1](https://github.com/jackaI1/lifeos-open/milestone/1) · 2026-11-03 to 2026-11-17 (2 weeks)

## Goal
Ship the first portfolio skill features behind green CI, on a working Scrum process: containers, PostgreSQL, Linux self-hosting, a React view, and prepared AWS and Microsoft 365 integrations.

## Committed stories
| Order | Issue | Story | Points | Branch | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | [#12](https://github.com/jackaI1/lifeos-open/issues/12) | Scrum workflow and Sprint 1 | 3 | `skills/scrum` | none |
| 2 | [#6](https://github.com/jackaI1/lifeos-open/issues/6) | Docker Compose container | 5 | `skills/docker` | none |
| 3 | [#7](https://github.com/jackaI1/lifeos-open/issues/7) | PostgreSQL support | 8 | `skills/postgres` | none (Compose profile joins #6) |
| 4 | [#9](https://github.com/jackaI1/lifeos-open/issues/9) | Linux self-hosting | 5 | `skills/linux` | none |
| 5 | [#10](https://github.com/jackaI1/lifeos-open/issues/10) | React view | 5 | `skills/react` | none |
| 6 | [#8](https://github.com/jackaI1/lifeos-open/issues/8) | AWS deployment target | 8 | `skills/aws` | #6; needs an AWS account for deploy |
| 7 | [#11](https://github.com/jackaI1/lifeos-open/issues/11) | Microsoft 365 sync | 8 | `skills/m365` | needs a Microsoft sign-in for end-to-end |

Total: 42 points. There is no velocity history yet, so this sprint is the baseline. Seven stories are being built in parallel on separate branches, so the risk is merge conflicts and the human-gated steps, not typing time.

## Risks and agreements
- #8 and #11 can only be fully Done after a human step (AWS credentials, Microsoft sign-in). They are labelled `blocked` at that point and carried over rather than marked Done unverified.
- Each story touches different directories (`Dockerfile`, `deploy/linux/`, `infra/aws/`, `integrations/m365/`, storage code, `public/` view). Shared files (README, `package.json`, `ci.yml`) are rebased on `main` before merging; merge order follows the table.
- If the sprint runs long, drop from the bottom of the table, not from the top.

## Board snapshot
Updated at review in [sprint review and retro](sprint-review-retro-template.md) format as `sprint-1-review.md`.
