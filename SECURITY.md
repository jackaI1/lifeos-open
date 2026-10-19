# Security

The default is a fictional local demo bound to loopback. For a private workspace, set `AUTH_MODE=local`, a random `LOCAL_ACCESS_TOKEN` of at least 24 characters, `DEMO_SEED=false`, and a new database path. Local mode is single-user. It is not a hosted multi-user authentication system.

SQLite files, browser drafts and local backups are not encrypted by this app. Use operating-system account protection and disk encryption. The server rejects unexpected hosts, cross-origin writes and invalid CSRF tokens. Never expose demo mode on a network or publish a populated database.

LLM and Google connections are opt-in. Selecting a real provider can send data to that provider and incur its charges. Review its configuration before enabling it. The repository includes no credentials.

Report vulnerabilities privately to the repository maintainer through the repository's private security reporting facility when configured. If unavailable, request a private contact channel without posting secrets or private records in a public issue.
