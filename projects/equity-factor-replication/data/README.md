# Public source snapshots

The two ZIPs in `raw/` are unmodified public monthly portfolio-return downloads from Kenneth R. French's Data Library, retrieved at the UTC times in `manifest.json`. The manifest records their official URLs, byte sizes, source vintage and SHA-256 hashes. No individual or private records are included.

The default research run reads these committed snapshots offline and verifies hashes before parsing. Source data are revised over time, so downloading today's URL may produce different bytes. `uv run momentum --download` verifies any replacement against the frozen manifest before writing it, and fails if the source has changed. Use the committed snapshots to reproduce this report. A new vintage needs a deliberately reviewed manifest update and a new report, not a silent refresh.

French credits the underlying CRSP data in the source headers. These are freely accessible research portfolio aggregates, not a redistribution of individual-stock CRSP records. See the [Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html) for source documentation. No license over the underlying data is claimed here.
