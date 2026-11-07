# Taking live notes

I want to read a short spoken note before waiting for an entire saved recording.
In the local workspace I open **School → Lectures → a notebook → Transcript →
Open live microphone transcript**, or go directly to `/live-voice.html`.
I choose **Start microphone**, allow the microphone, then **Finish recording**.
I keep the page open until it says **Finished** and copy any text I want to keep.
The saved lecture-recording workflow still works separately.

## Setup

Use Node 24 and the [existing Whisper setup](whisper.md#setup-macos-or-linux).
The model download is a separate setup step. For a small CPU model:

```sh
make install
make build
WHISPER_PYTHON=/path/to/whisper-venv/bin/python WHISPER_MODEL=tiny.en npm start
```

Open `http://127.0.0.1:8787/live-voice.html`. There is no hosted speech API and no
key. Recognition runs in a separate Python process using faster-whisper.
The public browser-only demo has no microphone worker. It keeps its authored
sample transcript. This feature does not publish or upload recordings.

## How a recording travels

An AudioWorklet, a browser audio processor, collects about three seconds of mono
sound. The client encodes each chunk as an independent 16-bit WAV file; it does
not split a compressed recording into pieces a decoder cannot read. The worker
recognizes one complete chunk at a time. Results contain text and millisecond
start/end positions relative to the beginning of this recording. Offsets come
from the audio sample count, not a browser clock.

`src/voice/protocol.ts` defines the shared TypeScript protocol:

| Direction | Message | Meaning |
| --- | --- | --- |
| Browser to server | `start` | Version 1, random 256-bit session id, CSRF value, last received sequence (`after`, initially -1) |
| Browser to server | `audio` | Zero-based sequence and base64 mono PCM16 WAV, at most five seconds |
| Server to browser | `start` | Next completed sequence and one worker credit, or zero while busy |
| Server to browser | `partial` | Completed chunk sequence and ordered timestamped passages |
| Both | `final` | Browser requests a flush after the last acknowledged sequence; server returns the full transcript |
| Server to browser | `error` | Code, expected next sequence, safe message and whether retry is allowed |

Only completed recognition advances the sequence. Duplicate chunks replay their
previous result, without recognizing the audio twice. After a disconnect, the
client resends unacknowledged chunks and the server replays missed partials. A
replacement socket takes ownership; an old socket cannot keep writing. Sessions
survive a two-minute disconnection in this process. A server restart or expired
session produces an explicit error; this is not disk-backed recovery.

The worker accepts one chunk across all sessions. Saved-recording and live
recognition share one inference slot, so they cannot load competing models at
the same time. A saved recording already using that slot also produces busy
back-pressure for the live stream. A busy error does not consume
a sequence number. The browser retries after 500 ms and retains up to ten chunks
(about 30 seconds). If recognition cannot keep up, recording stops with an
explanation instead of silently losing audio. Finish first flushes the worklet's
short tail, then drains every pending chunk, then requests final. Closing a tab
aborts this temporary session; use Finish to get the final tail.

The socket checks Host, Origin, the existing workspace session and CSRF before
accepting audio. Payload size, sample format, session count, transcript bytes,
recording length and inference time are bounded. Temporary WAV files are removed
in `finally`; shutdown aborts the owned inference process and closes sockets.
Text is rendered with `textContent`, so recognized markup stays text.

## Repeat the checks

```sh
node --test test/voice.test.mjs test/voice-client.test.mjs
# Linux CI installs the model and browser for these:
WHISPER_PYTHON=python node --test test/voice-inference.integration.mjs
WHISPER_PYTHON=python node --test tools/voice-browser.test.mjs
```

The lightweight checks use actual WebSocket connections and the recorded
public-domain fixture with a controlled recognizer for deterministic failure and
back-pressure tests. The separate integration uses the real local model and
recording across multiple independently decodable chunks, reconnect and final
flush. The browser check supplies that recording as Chrome's microphone and
uses the real page, worklet, socket and model. CI keeps browser screenshots on
failure. Tests close their sockets, browser contexts, server, child processes
and temporary files. Chunked recognition can lose context at a boundary and is
not a measure of classroom speech accuracy.
