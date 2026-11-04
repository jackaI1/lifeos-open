# Local Whisper lecture transcription

LifeOS can transcribe saved lecture recordings with a local
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) CPU model. Transcript
timestamps use the same clock as handwriting. Selecting a sentence seeks its
audio and opens the closest visible handwritten stroke from that recording
within 30 seconds, including notes on another notebook page. Original ink,
audio and slides remain editable through the existing workflows.

The public [browser demo](https://lifeos.jacklai.ca) uses an **authored** sample
transcript. Live inference runs in the local Node edition, not on the static
public host. This repository's public-domain fixture and CI run demonstrate
actual speech recognition without an API key or personal lecture recording.

## Setup (macOS or Linux)

Install Node 24+, Python 3.12 and [uv](https://docs.astral.sh/uv/). From the
repository root:

```sh
npm ci
uv venv --python 3.12 .local/whisper-venv
uv pip sync --python .local/whisper-venv/bin/python tools/whisper/requirements.lock
.local/whisper-venv/bin/python tools/whisper/transcribe.py --model base.en --download-only
WHISPER_PYTHON=.local/whisper-venv/bin/python WHISPER_MODEL=base.en npm run dev
```

The explicit setup command downloads model weights from Hugging Face. Normal
jobs use cached weights with `local_files_only=True`: neither audio nor
transcripts leave the machine. PyAV decodes the recorder's WebM/Opus, MP4,
Ogg and WAV files, so no system FFmpeg is required. The dependency lock pins
PyAV 16 because PyAV 19 removed an argument required by faster-whisper 1.2.1.
This adapter reads the local file store; `GOOGLE_MODE=real` disables it rather
than fetching private audio from Google. Model weights and the Python environment stay outside Git in ignored local
caches. Use a local model directory as `WHISPER_MODEL` for an air-gapped install.

In School → Lectures, open a notebook, record, then **Pause** and let its audio
save. Open **Transcript** (inside More on a phone), then **Transcribe locally**.
Notes and saves remain usable during recognition. Use **Refresh transcript**
to see completion, then select a timestamp to replay audio beside your notes.
New audio requires **Transcribe saved audio again**. Recognition errors leave
the previous transcript intact and expose a retry. Without `WHISPER_PYTHON`,
the controls explain that setup is needed; authored examples stay labelled.

`WHISPER_LANGUAGE` defaults to `en`; set a language code with a multilingual
model (for example `WHISPER_MODEL=base WHISPER_LANGUAGE=fr`). Download that exact
model first. Start with `base.en` for English lectures; larger models trade
memory and time for possible accuracy improvements. The integration test uses
`tiny.en` to keep verification lightweight.

## Reproduce the public demonstration

```sh
.local/whisper-venv/bin/python tools/whisper/transcribe.py --model tiny.en --download-only
WHISPER_PYTHON=.local/whisper-venv/bin/python npm run test:whisper
```

This runs the real API → durable job → Python model → saved transcript path on
the bundled [11-second public-domain clip](../test/fixtures/whisper/README.md).
The reference text is supplied only to the evaluator, never to the model.
It asserts at most 20% word error rate after removing punctuation/case, multiple
timestamped segments, valid clip ranges, responsive API access during inference,
and reversible mapping between media time and the handwriting clock. A synthetic
2:1 clock drift and recording gap exercise synchronization beyond the simple
zero-offset case. JSON evidence is saved to ignored
`.runtime/whisper/evaluation.json`.

Measured on Apple Silicon with `tiny.en`: **0.0% word error rate, two segments,
1.03 seconds including Python startup** for the 11-second clip. This is one
clean English recording, not a classroom accuracy benchmark. Background noise,
technical vocabulary and overlapping speakers can produce errors; the original
audio remains the reference. Empty recognition produces an empty transcript,
not an authored replacement.

`npm test` also covers clock drift, paused clips, notes on other pages, CSRF,
idempotency, chunk corruption, missing bytes, concurrent kickoff, stale source
rejection, retries, expired leases and shutdown/restart recovery. CI runs both
these regressions and the real-model fixture. Existing notebook recording and
replay browser tests continue to run.

## Implementation and resource lifecycle

- [`src/cloud/lecture-transcription.mjs`](../src/cloud/lecture-transcription.mjs)
  validates the authenticated/CSRF-protected request, snapshots up to 500 saved
  clips and queues one active job per lecture. Generic demo jobs cannot mark
  recognition complete.
- [`src/local/whisper.ts`](../src/local/whisper.ts) runs one background job at a
  time per workspace service. It verifies ordered local chunk bytes against
  SHA-256, reconstructs each clip in a private temporary directory, launches a
  scoped Python child, validates the output and commits an audited transcript
  only while its lease and source versions remain valid. Concurrently added or
  changed audio causes a retryable failure instead of a stale transcript.
- [`tools/whisper/transcribe.py`](../tools/whisper/transcribe.py) loads one
  CPU/int8 model per lecture, with two CPU threads, deterministic decoding and
  voice activity detection. Each clip retains its identity across recording
  pauses. No cloud transcription endpoint or credential is used.
- [`src/local/whisper-transcript.mjs`](../src/local/whisper-transcript.mjs) scales
  media seconds into each clip's `startMs`–`endMs` clock span using the decoded
  audio duration. Native media offsets are retained for exact playback even
  when a legacy recording has stale saved duration metadata.
- [`public/lecture-transcript.js`](../public/lecture-transcript.js) reverses that
  mapping for playback and finds nearby visible ink. The notebook's existing
  playback listener highlights ink as the transcript/audio advances.

The child has a one-hour job deadline; graceful shutdown aborts it, escalates
to SIGKILL after two seconds if needed, waits for exit, removes temporary audio
and requeues interrupted work before closing SQLite/PostgreSQL. A private
`process.json` in the temporary directory records owner, PID, start time, no
listening port and the scoped cleanup command while inference runs. Ctrl-C
stops the owning LifeOS server and its child. No detached daemon or polling
timer is installed. A crash lease expires after 61 minutes; the next startup
or successful write recovers expired work. A failed model setup surfaces a
setup/retry message without logging private audio or transcription text.

The optional Python setup is separate from the default Docker image; a custom
container must install the locked Python dependencies and supply cached weights
to enable this feature there.
