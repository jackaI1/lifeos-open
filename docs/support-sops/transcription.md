# A recording needs a transcript

For a recording without a transcript, finish the local Whisper setup in
docs/whisper.md first. In School, open Lectures, record in a notebook, pause and
let the audio save. Choose Transcript, then Transcribe locally. On a phone,
Transcript is under More. Refresh the transcript and select a timestamp to
listen again.

If Whisper is unavailable, check `WHISPER_PYTHON` points to the installed Python
environment. The speech model must already be downloaded. Recognition runs on
the computer after setup. Keep the original audio and check generated text
against it; the assistant cannot reconstruct a missing recording.
