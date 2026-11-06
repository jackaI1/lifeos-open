# Saved-text retrieval is unavailable

For missing retrieval or embedding files, run `npm run rag:download` once while
online. Start LifeOS with `RAG_MODE=local npm run dev`, then ask the Academic
advisor about a saved note. Embedding and search run locally after setup.

If a question has no matching passage, add the missing fact to a saved note or
ask a narrower question. An unrelated answer is not a successful repair.

Stop LifeOS before changing the derived retrieval index path. Give each workspace
its own `RAG_DATABASE`. Keep the workspace database and backups unchanged.
If retrieval remains unavailable, check that the configured cache and index
directories are readable. Escalate permission failures to the workspace owner.

Full instructions: docs/retrieval.md.
