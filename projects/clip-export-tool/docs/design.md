# Design notes

## Parts

- `clip_export/edits.py` validates JSON edit lists and their names, source intervals and tags.
- `clip_export/captions.py` reads strict UTF-8 SRT, intersects cues with each source interval and writes clip-local SRT.
- `clip_export/media.py` probes inputs, renders clips and publishes finished exports.
- `clip_export/catalogue.py` owns SQLite transactions, literal text/tag searches and ordered rough cuts.
- `clip_export/__main__.py` exposes the three workflows and reports readable errors with a nonzero exit status.

## Rendering choices

All intervals are half open: a cue ending exactly where a clip starts is omitted. A cue that crosses the clip start begins at zero; one crossing the end is cut there. This avoids negative caption times and showing captions from neighbouring clips. Subtitle files live in the render's temporary folder under a fixed filename, so punctuation in a user's source or caption path never enters FFmpeg's filter-language syntax.

The video filter first accounts for the input sample aspect ratio, which describes the shape of a stored pixel. It then scales the displayed picture proportionally and either pads or centre-crops to the requested dimensions. The output has square pixels, even dimensions, a fixed 30 fps and the broadly playable yuv420p pixel format. FFmpeg's default automatic rotation handles orientation metadata before filtering.

Audio analysis and encoding both convert to 48 kHz stereo, then use the EBU R128 `loudnorm` filter with targets of −16 LUFS, −1.5 dBTP and 11 LU loudness range. Measured integrated loudness, peak, range, threshold and offset feed the second pass. FFmpeg can fall back to dynamic processing if linear gain would exceed a target. Audio is aligned to the cut start and padded or trimmed to its video duration. Nonfinite measurements from silent or very short audio preserve its level without running the loudness filter, avoiding invalid gain values. Inputs with no audio get a generated silent track. No source audio is replaced by the example's test tone during normal use.

Rough cuts render each selected source interval to the same format, codec, frame rate and audio layout. FFmpeg's concat demuxer joins those temporary files in the supplied ID order without another lossy encode. Repeated IDs are allowed. AAC frame padding means joined container duration may differ slightly from the mathematical sum, so integration checks allow 120 ms for the two-piece fixture. There are no transitions or automatic subject tracking.

Filter reference: [FFmpeg's official filter documentation](https://ffmpeg.org/ffmpeg-filters.html), especially `scale`, `setsar`, `pad`, `crop`, `subtitles` and `loudnorm`.

## Local catalogue

`clips` stores an integer ID, absolute source path, clip name, start/end seconds and optional absolute caption path. `(source, name)` is unique. Reimport updates timestamps and captions, replaces tags and retains the ID. `tags` has a compound primary key and an index on the tag name. Each import is one transaction, and connections close explicitly after every operation.

Search uses bound SQL parameters. Literal `%`, `_` and backslash are escaped rather than treated as search wildcards. Name/tag substring matches and exact tags use SQLite's ordinary ASCII case rules. Search results are ordered by ID; rough cuts instead preserve the caller's requested order. The database is a local index, so moving source files requires reimporting under the new location. It does not copy or deduplicate footage by file contents.

## Errors and resource ownership

All cuts are checked against the video endpoint before output creation. Stream duration or a Matroska DURATION tag supplies that endpoint; a bounded-memory scan of video packet timestamps is the fallback. Container duration is never substituted because an audio track can extend beyond the picture. Staged outputs are probed again to confirm a video stream with the requested duration before publication. Duplicate or unsafe names, invalid JSON fields, nonfinite timestamps, invalid SRT and unsupported formats are rejected. A missing source or caption file fails before rendering. Existing output files are never overwritten.

Each export owns a temporary folder inside the output directory. All clips finish there before exclusive hard links publish the final names on the same filesystem. A failure removes any files published by that invocation, and the temporary-directory context removes staged media and subtitles. Rough cuts use the same ownership pattern and do not publish until concatenation finishes. The filesystem must support hard links, as normal local macOS and Linux filesystems do.

Every FFmpeg process runs synchronously with a 30-minute timeout per invocation and two encode threads; ffprobe has a one-minute timeout. Diagnostic logs use temporary files and retain at most their final 32 KiB in memory; user-facing FFmpeg failures show at most 4 KiB. No server, browser session or background worker is started. Tests own their fixtures through temporary-directory cleanup.

## Verification

`python3 -m unittest discover -v` runs both pure timing/validation checks and actual FFmpeg processing. Caption visibility tests decode output frames before, inside and after a source-timed cue. Aspect tests inspect a coloured square to detect stretching. Duration/dimension checks inspect ffprobe's output, while a fresh loudness measurement checks the encoded audio. Catalogue tests include stable reimports, literal searches, missing IDs, mixed sources with/without audio, CLI errors and the visible order of the assembled cut.

CI installs FFmpeg and DejaVu fonts on Ubuntu 24.04, runs the full suite with Python 3.9 and 3.12, and renders the included public-domain sample. No credentials, remote service or runtime network access are needed.
