# Feature inventory

All 21 source screen modules are retained. Fifteen are top-level navigation destinations; other modules appear inside academics, settings or reminders. No screen module was dropped. The original email feature remains a local preview. Managed hosting, push delivery and native automatic deployments are represented by local status/mock services; they require operator setup for real external effects.

| Module | Feature group | Standalone status |
| --- | --- | --- |
| `cooking` | Recipes, preparation/follow modes, step timers, grocery review and mock help | Works with local/mock services |
| `coop` | Saved opportunities, tasks and mock application drafts | Works with local/mock services |
| `devices` | Presence credential management and device list | Works with local/mock services |
| `devotional` | Seven responses, custom entries, completion, history and archival | Works with local/mock services |
| `email` | Sample messages and offline local email drafts/export | Works with local/mock services |
| `exercise` | Run logging, context, reference plan and pace comparison | Works with local/mock services |
| `finances` | Budget, transactions, reconciliation, categories, forecasts and advisor | Works with local/mock services |
| `friends` | Contact schedules, memories, imports and prayer links | Works with local/mock services |
| `handoff` | Task context packets, preview and approved return edits | Works with local/mock services |
| `journal` | Daily journal, prompts/templates and revisions | Works with local/mock services |
| `lectures` | Notebooks, timed ink/audio, recording/recovery, slides, tutor and study aids | Works with local/mock services |
| `notes` | Private rich notes, folders, pinning, images and recovery | Works with local/mock services |
| `photos` | Daily photo import, captions, history and image storage | Works with local/mock services |
| `prayer` | Prayer list/tree, recording, journal, transcript review and generic daily prayer | Works with local/mock services |
| `quota` | Usage/admission status and quota settings | Works with local/mock services |
| `reminders` | Lists, recurrence, priorities, groceries, staples and undo | Works with local/mock services |
| `school` | Academics, assignment briefs, coursework, co-op and academic advisor | Works with local/mock services |
| `settings` | Preferences, privacy, backup/export, revisions, deletion and service status | Works with local/mock services |
| `support` | App support conversations and mock maintenance reports | Works with local/mock services |
| `today` | Schedule, overlapping events, ranked work, presence, travel and timers | Works with local/mock services |
| `week` | Tickets, side projects, project help and preparation artifacts | Works with local/mock services |

The detailed JSON lists module source files, exported mounts and referenced API routes. Source route implementations remain in `src/cloud`. The fictional seed, typed local service and API/browser tests cover the standalone path. A live external deployment has not been certified.
