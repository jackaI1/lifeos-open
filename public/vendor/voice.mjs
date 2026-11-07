// src/voice/client.ts
var VoiceClient = class {
  socket;
  session = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
  queue = /* @__PURE__ */ new Map();
  next = 0;
  after = -1;
  inflight = false;
  ready = false;
  ending = false;
  stopped = false;
  timer;
  retries = 0;
  url;
  csrf;
  partial;
  status;
  finished;
  constructor(url, csrf, partial, status, finished) {
    this.url = url;
    this.csrf = csrf;
    this.partial = partial;
    this.status = status;
    this.finished = finished;
  }
  connect() {
    if (this.stopped) return;
    this.socket = new WebSocket(this.url);
    this.socket.onopen = () => this.send({ type: "start", version: 1, session: this.session, csrf: this.csrf, after: this.after });
    this.socket.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "start") {
        this.ready = true;
        this.inflight = false;
        this.retries = 0;
        this.status("Connected. Audio stays on this computer.");
        this.schedule();
      }
      if (m.type === "partial") {
        if (m.seq > this.after) {
          this.after = m.seq;
          this.partial(m.segments);
        }
        for (const seq of this.queue.keys()) if (seq <= this.after) this.queue.delete(seq);
        this.inflight = false;
        this.schedule();
      }
      if (m.type === "error") {
        if (m.retryable) {
          this.inflight = false;
          this.status("Worker busy. Keeping audio until it is ready.");
          this.schedule(500);
        } else this.fail(m.message);
      }
      if (m.type === "final") {
        this.stopped = true;
        clearTimeout(this.timer);
        this.socket?.close();
        this.status("Finished. Last audio chunk flushed.");
        this.finished();
      }
    };
    this.socket.onclose = () => {
      this.ready = false;
      this.inflight = false;
      if (!this.stopped) {
        if (++this.retries > 12) {
          this.fail("Connection unavailable. Stop and try again.");
          return;
        }
        this.status("Reconnecting. Keeping unacknowledged audio.");
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.connect(), Math.min(5e3, 250 * 2 ** this.retries));
      }
    };
    this.socket.onerror = () => this.socket?.close();
  }
  push(wav) {
    if (this.ending || this.stopped) throw Error("Recording is closed.");
    if (this.queue.size >= 10) {
      this.fail("Recognition cannot keep up. Stop and use the saved-recording transcript.");
      throw Error("Audio buffer full.");
    }
    let binary = "";
    for (const byte of wav) binary += String.fromCharCode(byte);
    this.queue.set(this.next++, btoa(binary));
    this.pump();
  }
  finish() {
    this.ending = true;
    this.pump();
  }
  cancel() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.queue.clear();
    this.socket?.close();
  }
  fail(message) {
    this.cancel();
    this.status(message);
    this.finished();
  }
  send(m) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(m));
  }
  schedule(delay = 0) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pump(), delay);
  }
  pump() {
    if (!this.ready || this.stopped || this.inflight) return;
    const chunk = this.queue.entries().next().value;
    if (chunk) {
      this.inflight = true;
      this.send({ type: "audio", seq: chunk[0], wav: chunk[1] });
    } else if (this.ending) {
      this.inflight = true;
      this.send({ type: "final", seq: this.after });
    }
  }
};

// src/voice/protocol.ts
var MAX_WAV = 48e3 * 2 * 5 + 44;
function pcmWav(samples, rate) {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const ascii = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true));
  return bytes;
}

// src/voice/page.ts
var start = document.querySelector("#start");
var stop = document.querySelector("#stop");
var state = document.querySelector("#state");
var text = document.querySelector("#transcript");
var stream;
var context;
var node;
var client;
async function release(ready = true) {
  const audio = context;
  context = void 0;
  stream?.getTracks().forEach((t) => t.stop());
  stream = void 0;
  node?.disconnect();
  node = void 0;
  stop.disabled = true;
  if (ready) start.disabled = false;
  if (audio && audio.state !== "closed") await audio.close();
}
start.onclick = async () => {
  start.disabled = true;
  text.replaceChildren();
  try {
    const session = await (await fetch("/api/session")).json();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
    context = new AudioContext({ sampleRate: 16e3 });
    await context.resume();
    await context.audioWorklet.addModule("/voice-worklet.js");
    node = new AudioWorkletNode(context, "voice-chunks");
    client = new VoiceClient(location.origin.replace(/^http/, "ws") + "/api/voice", session.csrf, (segments) => {
      for (const s of segments) {
        const li = document.createElement("li");
        li.textContent = `${(s.startMs / 1e3).toFixed(1)}\u2013${(s.endMs / 1e3).toFixed(1)}s: ${s.text}`;
        text.append(li);
      }
    }, (message) => {
      state.textContent = message;
    }, () => {
      void release();
    });
    const rate = context.sampleRate;
    node.port.onmessage = (e) => {
      if (e.data.type === "chunk") {
        try {
          client?.push(pcmWav(new Float32Array(e.data.samples), rate));
        } catch {
          void release();
        }
      }
      if (e.data.type === "flushed") {
        client?.finish();
        void release(false);
      }
    };
    context.createMediaStreamSource(stream).connect(node);
    node.connect(context.destination);
    client.connect();
    stop.disabled = false;
    state.textContent = "Connecting. Speak a short note.";
  } catch (e) {
    client?.cancel();
    state.textContent = e.message;
    await release();
  }
};
stop.onclick = () => {
  stop.disabled = true;
  node?.port.postMessage({ type: "flush" });
  state.textContent = "Finishing the last chunk\u2026";
};
window.addEventListener("pagehide", () => {
  client?.cancel();
  void release();
});
