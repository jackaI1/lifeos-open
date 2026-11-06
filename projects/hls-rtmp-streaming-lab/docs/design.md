# Pipeline design

I chose nginx with its RTMP module to keep a real ingest boundary between the source and the packager. A direct file-to-HLS conversion would not exercise publishing or receiving a broadcast. I considered letting nginx create HLS directly, but FFmpeg gives me explicit encoding and caption control. I use its native HLS subtitle muxer instead of maintaining my own caption segmenter.

## Services

`compose.yaml` builds one runtime image, reused by four commands. `ingest` accepts RTMP on 1935 and serves the player and HLS on 8080. `packager` pulls only `live/demo`, reads a sidecar transcript, and writes to a dedicated volume. The optional `publisher` sends a finite synthetic source in real time. The optional `validator` reads output over HTTP and probes each media segment.

The host ports bind to loopback. The web service mounts the output read-only. Images install distribution FFmpeg and nginx packages, with a Debian base pinned by digest and a lockfile for the self-hosted player. Updating packages can change encoder output, so tests check properties rather than byte-for-byte golden files.

## Timeline and captions

FFmpeg splits the picture into 1280×720, 854×480 and 640×360 streams. Fixed 24 fps and 48-frame GOPs align independent two-second segments. The codecs are H.264 and AAC. `mpegts_copyts=1` prevents the MPEG-TS muxer from adding its usual timestamp offset; both the transport stream and WebVTT use a zero-based clock. Validation checks that clock against the encoded packets, not just EXTINF declarations.

Only the first entry in `var_stream_map` declares the subtitle stream and its group. FFmpeg automatically associates that group with every variant in the master playlist. Repeating a subtitle group on a variant without a subtitle stream caused a crash in a host FFmpeg compatibility experiment. Both the Docker end-to-end check and the browser check protect this integration.

The prepared English transcript describes the 16-second test. An empty VTT segment is valid during a gap between spoken captions, but the overall caption track must contain actual cues. Cue boundaries can span segment boundaries; the validator checks intersection rather than requiring captions to fit entirely in one video piece.

## Session lifecycle

The packager retries a missing RTMP source, finishes after a successful broadcast and leaves a replay. Restarting it clears the dedicated output directory before accepting another session. This explicit lifecycle prevents one recording from silently sharing stale segments with the next. nginx permits the subscriber to connect before publishing and sends explicit play start/stop notifications (`play_restart on`), so FFmpeg receives the first keyframe and closes its playlists at the end. The second end-to-end session tests this restart path. A lost connection may finish a partial event; seamless reconnection and discontinuity handling are outside this lab.

The source must include video and audio. No transcription, adaptive encoding ladder selection, multi-stream routing, authentication or public CDN is included. Event playlists preserve all pieces, so a long event consumes increasing storage. Two-second HLS is intentionally higher latency than a video call.

## Validation and resource ownership

`stream/validate.py` supports the unencrypted MPEG-TS/event subset emitted here, local files or same-directory HTTP resources. It rejects unsafe and escaping references, incomplete playlists, missing or empty pieces, inconsistent timelines and broken captions. The optional probe path checks video codec and size, audio codec, first-packet keyframes, segment duration, continuous timestamps and aligned rendition clocks.

`scripts/e2e.py` uses a unique Compose project and dynamically allocated loopback ports. It records container IDs, VM PIDs/start times, port mappings and cleanup commands, and removes that project's containers, volume and network in a finally block. Chromium tests use one owned browser process, close their pages and browser, then assert that process has exited. Failure diagnostics show only bounded log tails. Docker's shared daemon and VM remain running because other projects may use them.

I refer to the [nginx RTMP directives](https://github.com/arut/nginx-rtmp-module/wiki/Directives) and [FFmpeg HLS muxer documentation](https://ffmpeg.org/ffmpeg-formats.html#hls-2) for the protocol options.
