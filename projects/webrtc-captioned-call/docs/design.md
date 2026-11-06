# Call design

## Two people, one session

The same Node process serves the browser app and `/signal` WebSocket endpoint. The server's in-memory map holds a set of at most two sockets for each room. A `joined` response acknowledges a successful join. When the second person arrives, both receive `peer-ready`; only the first creates the offer and the `captions` data channel. Both browsers already have their media tracks before they join, so the initial offer includes audio and video without a second negotiation.

All client messages are a strict discriminated union validated with Zod. A room code contains 6 to 64 letters, digits, hyphens or underscores. Offers and answers carry an SDP string. ICE messages carry a bounded candidate object or `null` for end-of-candidates. Invalid messages return an error; the server limits payloads to 64 KiB, refills a 120-message token bucket over a minute, caps rooms at 1,000 and caps queued socket output. Browser upgrades must have the same host as their Origin. A 30-second ping/pong heartbeat releases dead sockets. Disconnects delete empty rooms and notify the remaining peer.

On the browser, a promise chain serializes incoming signalling messages. ICE that arrives before a remote description is queued until `setRemoteDescription` finishes. Each callback checks that it still belongs to the current session, so an old close event cannot end a newly joined call. A generation counter handles leaving while a media permission prompt or configuration request is still pending. Acquired streams are registered as pending ownership immediately; leaving stops them and aborts the configuration fetch before a peer connection exists. Configuration fetches also time out after ten seconds. No automatic retries or background reconnect loops are created.

## Caption path

`getUserMedia` supplies the same microphone track to the peer connection and the local audio capture path. An AudioWorklet groups four seconds of mono samples without blocking the interface. The client downsamples to 16 kHz and skips chunks with RMS amplitude below 0.008. This is a simple silence gate, not a trained voice-activity detector. Whisper tiny.en runs with quantized weights in a dedicated browser worker using the WASM backend and one inference thread. Remote model loading is disabled; the model and runtime are served by the app.

There is at most one inference in flight. When inference is busy, arriving chunks are dropped rather than queued. Text is limited to 512 characters. A reliable ordered RTCDataChannel named `captions` carries `{type:"caption",version:1,sequence:0,text:"..."}`. Each receiver validates the message, ignores duplicates/out-of-order sequences and uses `textContent` when rendering. Buffered data above 64 KiB causes a caption to be skipped. The transcript holds the last 50 lines, in memory only. Disabling captions terminates its worker and closes its AudioContext, while the call continues.

## Leaving and failure

Leaving, losing the signalling server, a failed peer connection, a partner leaving, or page navigation closes the channel, peer connection, WebSocket, interval and caption worker. It stops all local media tracks, clears both video elements and clears the transcript. Caption initialization checks its stopped flag after async work, so a late model/audio response cannot revive a stopped session. Stats are sampled once per second and late reports are ignored after teardown.

The application is not an authenticated conferencing service. Room codes are invitations, the server is trusted for negotiation, and there is no persistence, group-call mixing or renegotiation for device switching. A temporary network interruption is reported; a failed connection asks the user to rejoin. Captions are approximate English chunks rather than streaming word-by-word recognition.

## Verification

Unit tests exercise protocol rejection, actual WebSocket relaying, room isolation/capacity, disconnect replacement and rate limits, plus audio and caption validation. Playwright launches one owned Chromium with two isolated contexts, a fake camera and a synthetic PCM microphone file. Its caption test executes the production capture/worklet/model/channel path, without replacing the worker or peer connection. Production assets are built before the browser campaign. Test contexts close in `finally`; Playwright owns browser and server teardown. The server prints its PID, start time, port and exact graceful-stop command when it starts.
