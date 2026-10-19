import { LECTURE, recordingApproved } from "./lecture-core.js";
const hash = async (blob) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const pad = (n) => String(n).padStart(4, "0");
export class LectureRecorder {
  constructor({
    id,
    store,
    clock,
    request,
    changed = () => {},
    mediaDevices = navigator.mediaDevices,
    Recorder = globalThis.MediaRecorder,
    setTimer = (...args) => setTimeout(...args),
    clearTimer = (id) => clearTimeout(id),
  }) {
    Object.assign(this, {
      id,
      store,
      clock,
      request,
      changed,
      mediaDevices,
      Recorder,
      setTimer,
      clearTimer,
    });
    this.state = "idle";
    this.pending = Promise.resolve();
    this.bytes = 0;
    this.flushPromise = null;
    this.audioSegmentId = null;this.audioTimeline=[];
    this.stopping = null;
  }
  segmentForOffset(offset){return this.audioTimeline.findLast(s=>s.startMs<=offset&&(s.endMs===null||offset<=s.endMs))?.id??null;}
  async start(permission) {
    if (this.emergencyChunks?.length && !this.emergencyAcknowledged)
      throw new Error(
        "Export the unsaved emergency audio before recording again.",
      );
    if (!recordingApproved(permission))
      throw new Error(
        "Confirm course recording permission before using the microphone.",
      );
    if (this.state === "recording") return;
    this.recordingWanted = true;
    if (!this.Recorder)
      throw new Error("This browser cannot record audio. Notes still work.");
    await this.store.open?.();
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (estimate && estimate.quota - estimate.usage < 64 * 1024 * 1024)
      throw new Error(
        "Less than 64 MB of local storage is available. Free space before recording.",
      );
    this.stream = await this.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false },
      video: false,
    });
    try {
      this.mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((m) => this.Recorder.isTypeSupported(m));
      if (!this.mimeType)
        throw new Error("No supported lecture audio format. Notes still work.");
      await globalThis.navigator?.storage?.persist?.();
      await this.beginSegment();
      try {
        this.wakeLock = await globalThis.navigator?.wakeLock?.request("screen");
      } catch {}
      this.changed();
    } catch (e) {
      this.release();
      throw e;
    }
  }
  async beginSegment() {
    const space = await globalThis.navigator?.storage?.estimate?.();
    if (space && space.quota - space.usage < 16 * 1024 * 1024)
      throw new Error(
        "Local storage is almost full. Recording stopped before the next segment; export saved audio to free space.",
      );
    const meta = (await this.store.get("recording:" + this.id)) || { next: 1 };
    if (meta.next > 500)
      throw new Error("Lecture segment limit reached. Start a new lecture.");
    const number = meta.next++,
      segmentId = pad(number),
      key = `segment:${this.id}:${segmentId}`;
    await this.store.put("recording:" + this.id, meta);
    this.segment = {
      id: segmentId,
      lectureId: this.id,
      epochId: this.clock.epochId,
      startMs: this.clock.offset(),
      wallAt: new Date().toISOString(),
      endMs: null,
      mimeType: this.mimeType,
      status: "capturing",
      chunks: 0,
      bytes: 0,
      registerMutation: crypto.randomUUID(),
      finalizeMutation: crypto.randomUUID(),
    };
    await this.store.put(key, this.segment);
    this.part = 0;
    this.bytes = 0;
    this.error = null;
    const recorder = (this.recorder = new this.Recorder(this.stream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: 64000,
    }));
    this.segment.mimeType = recorder.mimeType || this.mimeType;
    let didStart=false,resolveStarted,rejectStarted;
    const started=new Promise((resolve,reject)=>{resolveStarted=resolve;rejectStarted=reject;});
    recorder.addEventListener("start", (event) => {
      didStart=true;
      const anchor = this.clock.anchor();
      this.segment.startMs = this.clock.eventOffset?.(event.timeStamp)??anchor.offsetMs;
      this.audioTimeline.push({id:segmentId,startMs:this.segment.startMs,endMs:null});
      this.segment.wallAt = anchor.wallAt;
      this.audioSegmentId = segmentId;
      this.state = 'recording';
      this.changed();
      resolveStarted();
      this.pending = this.pending
        .then(() => this.store.put(key, { ...this.segment }))
        .catch((error) => {
          this.error = error;
          this.changed();
          if (recorder.state !== "inactive") recorder.stop();
        });
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data?.size) return;
      const blob = event.data,
        first = this.part,
        count = Math.ceil(blob.size / LECTURE.uploadBytes);
      this.part += count;
      this.bytes += blob.size;
      const total = this.bytes;
      this.pending = this.pending
        .then(async () => {
          for (let n = 0; n < count; n++) {
            const slice = blob.slice(
              n * LECTURE.uploadBytes,
              (n + 1) * LECTURE.uploadBytes,
              blob.type,
            );
            try {
              await this.store.put(
                `chunk:${this.id}:${segmentId}:${pad(first + n)}`,
                slice,
              );
            } catch (error) {
              this.emergencyAcknowledged = false;
              (this.emergencyChunks ||= []).push({
                segmentId,
                index: first + n,
                blob: blob.slice(n * LECTURE.uploadBytes, blob.size, blob.type),
              });
              throw error;
            }
            this.segment.chunks = first + n + 1;
            this.segment.bytes = total;
            await this.store.put(key, { ...this.segment });
          }
        })
        .catch((error) => {
          this.error = error;
          this.changed();
          if (recorder.state !== "inactive") recorder.stop();
        });
      if (this.bytes > LECTURE.maxSegmentBytes) {
        this.error = new Error(
          "This audio segment exceeded the safe upload size. Recording stopped; local chunks are retained for export.",
        );
        if (recorder.state !== "inactive") recorder.stop();
      }
    });
    this.segmentFinished = new Promise((resolve) =>
      recorder.addEventListener(
        "stop",
        async (event) => {
          this.clearTimer(this.timer);
          if(!didStart)rejectStarted(new Error('Recording stopped before the microphone was ready. Try Record again.'));
          this.audioSegmentId = null;
          const endMs = this.clock.eventOffset?.(event?.timeStamp)??this.clock.offset();
          const span=this.audioTimeline.find(s=>s.id===segmentId);if(span)span.endMs=endMs;
          await this.pending;
          this.segment = {
            ...this.segment,
            endMs,
            status: this.error ? "recovery-needed" : "captured",
          };
          try {
            await this.store.put(key, this.segment);
          } catch (e) {
            this.error = e;
            this.segment.status = "recovery-needed";
          }
          this.state = "paused";
          this.changed();
          resolve();
          if (this.error) {
            this.release();
            return;
          }
          void this.flush().catch(() => {});
        },
        { once: true },
      ),
    );
    recorder.addEventListener("error", () => {
      this.error = new Error(
        "Recording was interrupted. Captured chunks remain on this device.",
      );
      if(!didStart)rejectStarted(this.error);
      if (recorder.state !== "inactive") recorder.stop();
    });
    this.state='starting';
    recorder.start(LECTURE.chunkMs);
    await started;
    this.timer = this.setTimer(() => {
      void this.rotate().catch((e) => {
        this.error = e;
        this.state = "paused";
        this.release();
        this.changed();
      });
    }, LECTURE.segmentMs);
  }
  async rotate() {
    await this.stopSegment();
    if (this.recordingWanted && this.stream && !this.error)
      await this.beginSegment();
  }
  async stopSegment() {
    if (this.stopping) return this.stopping;
    this.clearTimer(this.timer);
    if (this.recorder?.state === "inactive") return this.segmentFinished;
    this.stopping = (async () => {
      if (this.recorder) this.recorder.stop();
      await this.segmentFinished;
    })();
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
    }
  }
  async pause() {
    this.recordingWanted = false;
    await this.stopSegment();
    this.release();
    this.state = "paused";
    this.changed();
  }
  async stop() {
    await this.pause();
    this.state = "stopped";
    this.changed();
  }
  release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.wakeLock?.release?.();
    this.wakeLock = null;
  }
  async segmentBlob(segment) {
    if (segment.bytes > LECTURE.maxSegmentBytes)
      throw new Error("Oversized segment needs local chunk export.");
    const parts = [];
    for (let i = 0; i < segment.chunks; i++) {
      const blob = await this.store.get(
        `chunk:${this.id}:${segment.id}:${pad(i)}`,
      );
      if (!blob)
        throw new Error(
          "An audio chunk is missing. Keep this device for recovery.",
        );
      parts.push(blob);
    }
    return new Blob(parts, { type: segment.mimeType });
  }
  async flush({ force = false } = {}) {
    if (this.flushPromise) return this.flushPromise;
    if (!force && Date.now() < (this.retryAt || 0)) return 0;
    this.flushPromise = this.sendPending();
    try {
      const result = await this.flushPromise;
      this.failures = 0;
      this.retryAt = 0;
      return result;
    } catch (e) {
      this.failures = (this.failures || 0) + 1;
      this.retryAt =
        Date.now() +
        Math.min(300000, 30000 * 2 ** Math.min(this.failures - 1, 4));
      throw e;
    } finally {
      this.flushPromise = null;
    }
  }
  async sendPending() {
    const keys = await this.store.keys(`segment:${this.id}:`);
    let saved = 0;
    for (const key of keys) {
      let s = await this.store.get(key);
      if (s.status !== "captured") continue;
      const base = `/api/lectures/${this.id}/clips/${s.id}`;
      try {
        const registered = await this.request(base, {
          method: "POST",
          body: {
            action: "register",
            mutationId: s.registerMutation,
            startMs: s.startMs,
            wallAt: s.wallAt,
            epochId: s.epochId,
            mimeType: s.mimeType,
          },
        });
        if (registered.item.data.status !== "saved") {
          const blob = await this.segmentBlob(s),
            count = Math.ceil(blob.size / LECTURE.uploadBytes);
          if (!count) throw new Error("The microphone produced no audio.");
          for (let i = 0; i < count; i++) {
            const chunk = blob.slice(
              i * LECTURE.uploadBytes,
              (i + 1) * LECTURE.uploadBytes,
              s.mimeType.split(";")[0],
            );
            const result = await this.request(base + "/" + i, {
              method: "POST",
              body: chunk,
              headers: {
                "Content-Type": chunk.type,
                "X-Content-SHA256": await hash(chunk),
                "X-Mutation-ID": s.registerMutation + ":chunk:" + i,
              },
            });
            if (!result.stored)
              throw new Error("Remote audio persistence was not confirmed.");
          }
          const result = await this.request(base, {
            method: "POST",
            body: {
              action: "finalize",
              mutationId: s.finalizeMutation,
              endMs: s.endMs,
              chunks: count,
            },
          });
          if (!result.saved)
            throw new Error("Remote recording was not finalized.");
        }
        s = {
          ...s,
          status: "saved",
          recordingId: registered.item.data.recordingId,
        };
        await this.store.put(key, s);
        saved++;
        this.uploadError = null;
        this.changed();
        // Keep original local chunks for independent recovery. Cleanup is a separate, explicit task.
      } catch (e) {
        this.uploadError = e;
        this.changed();
        throw e;
      }
    }
    return saved;
  }
  async recoverInterrupted() {
    for (const key of await this.store.keys(`segment:${this.id}:`)) {
      const s = await this.store.get(key);
      if (s.status === "capturing") {
        s.status = "recovery-needed";
        const keys = await this.store.keys(`chunk:${this.id}:${s.id}:`, 10000);
        s.chunks = keys.length;
        s.bytes = 0;
        for (const chunk of keys) s.bytes += (await this.store.get(chunk)).size;
        await this.store.put(key, s);
      }
    }
  }
}
