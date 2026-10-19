export async function sha256(blob) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join(''); }
export class PrayerRecorder {
  constructor({ store, request, action, changed = () => {}, mediaDevices = globalThis.navigator?.mediaDevices, MediaRecorder = globalThis.MediaRecorder }) {
    Object.assign(this, { store, request, action, changed, mediaDevices, MediaRecorder }); this.stream = null; this.recorder = null; this.state = 'idle'; this.session = null; this.persisting = Promise.resolve(); this.uploading = null; this.wakeLock = null;
  }
  notify(error) { this.changed({ state: this.state, session: this.session, error }); }
  async start(section = 0, wakeLock = false, prayerSnapshot = null) {
    if (!this.mediaDevices?.getUserMedia || !this.MediaRecorder) throw new Error('This browser does not support recording. Use a current Safari or Chrome browser.');
    if (['requesting', 'recording', 'paused', 'stopping'].includes(this.state) || this.recorder?.state && this.recorder.state !== 'inactive') return;
    this.state = 'requesting'; this.notify();
    try {
      this.stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => this.MediaRecorder.isTypeSupported(type));
      this.recorder = new this.MediaRecorder(this.stream, mimeType ? { mimeType } : {});
      this.session = { id: crypto.randomUUID(), mimeType: this.recorder.mimeType, startedAt: new Date().toISOString(), chunks: 0, prayerSnapshot, sections: [{ section, atMs: 0 }], state: 'recording', pausedMs: 0 };
      if (!await this.store.put(`recording:${this.session.id}`, { ...this.session, token: this.session.id })) throw new Error('Recording needs durable browser storage. Free storage or enable it before recording.');
      this.recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        const index = this.session.chunks++;
        this.persisting = this.persisting.then(async () => {
          const blob = event.data; const hash = await sha256(blob);
          const durable = await this.store.put(`upload:${this.session.id}:${String(index).padStart(6, '0')}`, { token: crypto.randomUUID(), sessionId: this.session.id, index, blob, hash, mimeType: blob.type, state: 'not-yet-sent' });
          if (!durable) { this.pause(); this.notify(new Error('Recording paused because this audio chunk could not be stored durably. Keep this page open while uploading or recovering storage.')); }
          await this.store.put(`recording:${this.session.id}`, { ...this.session, token: this.session.id });
          void this.flush();
        }).catch(error => this.notify(error));
      };
      this.recorder.onerror = event => { this.state = 'interrupted'; this.release(); this.notify(event.error || new Error('Recording was interrupted. Captured chunks are retained.')); };
      this.recorder.start(12000); this.state = 'recording'; this.notify();
      if (wakeLock && globalThis.navigator?.wakeLock && !document.hidden) { try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
    } catch (error) { this.state = 'idle'; this.release(); this.notify(error); throw error; }
  }
  mark(section) { if (this.session && ['recording', 'paused'].includes(this.state)) { this.session.sections.push({ section, atMs: (this.state === 'paused' ? this.pausedAt : Date.now()) - Date.parse(this.session.startedAt) - this.session.pausedMs }); void this.store.put(`recording:${this.session.id}`, { ...this.session, token: this.session.id }); } }
  pause() { if (this.recorder?.state === 'recording') { this.recorder.pause(); this.pausedAt = Date.now(); this.state = 'paused'; this.notify(); } }
  resume() { if (this.recorder?.state === 'paused') { this.session.pausedMs += Date.now() - this.pausedAt; this.recorder.resume(); this.state = 'recording'; this.notify(); } }
  async stop() {
    if (!this.recorder || this.recorder.state === 'inactive') { this.release(); return; }
    this.state = 'stopping'; this.notify();
    await new Promise(resolve => { this.recorder.addEventListener('stop', resolve, { once: true }); this.recorder.stop(); });
    this.release(); await this.persisting;
    this.session.endedAt = new Date().toISOString(); this.session.state = 'captured'; this.state = 'captured'; await this.store.put(`recording:${this.session.id}`, { ...this.session, token: this.session.id }); this.notify();
    await this.flush(); return this.finalize(this.session);
  }
  async finalize(session) {
    const chunks = await this.store.list(`upload:${session.id}:`);
    if (chunks.length) { const reason = chunks.find(item => item.value.error)?.value.error || 'Audio remains on this device. Some chunks are not yet uploaded.'; this.notify(new Error(reason)); return { pending: true, reason }; }
    try {
      if (!session.chunks) throw new Error('No captured chunks are known for this recording. Keep this browser storage intact.');
      const result = await this.action('upload-finalize', { sessionId: session.id, kind: 'prayer', mimeType: session.mimeType, totalChunks: session.chunks, title: `Prayer ${session.startedAt.slice(0, 10)}`, sections: session.sections, prayerSnapshot:session.prayerSnapshot, startedAt: session.startedAt, endedAt: session.endedAt });
      const accepted = !result.pending && Boolean(result.item || result.job);
      if (!accepted && !result.pending) throw new Error('LifeOS did not confirm the recording. Retry to check its saved state.');
      const receipt = { ...session, state: accepted ? 'uploaded' : 'captured', token: session.id, lastError: accepted ? null : result.reason || 'Cloud finalization is pending', ...(accepted ? { finalizedAt: new Date().toISOString(), jobId: result.job?.id ?? null } : {}) };
      await this.store.put(`recording:${session.id}`, receipt);
      if (!this.session || this.session.id === session.id) { this.session = receipt; this.state = receipt.state; }
      this.notify(); return result;
    } catch (error) {
      await this.store.put(`recording:${session.id}`, { ...session, token: session.id, lastError: error.message });
      this.notify(error); throw error;
    }
  }
  async recover(session) {
    await this.persisting; await this.flush();
    return this.finalize({ ...session, endedAt: session.endedAt || new Date().toISOString() });
  }
  flush() {
    if (this.uploading) return this.uploading;
    this.uploading = (async () => {
      let uploaded = 0, error = null;
      for (const { key, value } of await this.store.list('upload:')) {
        try {
          const result = await this.request(`/api/uploads/${value.sessionId}/${value.index}`, { method: 'POST', body: value.blob, headers: { 'Content-Type': value.mimeType || 'application/octet-stream', 'X-Content-SHA256': value.hash, 'X-Mutation-Id': value.token } });
          if (result?.stored !== true) throw new Error('LifeOS did not confirm this audio chunk. It remains on this device.');
          await this.store.remove(key, value.token); uploaded++;
        } catch (failure) {
          error = failure.message; await this.store.put(key, { ...value, error, lastAttemptAt: new Date().toISOString() }); break;
        }
      }
      return { uploaded, remaining: (await this.store.list('upload:')).length, error };
    })().finally(() => { this.uploading = null; }); return this.uploading;
  }
  release() { for (const track of this.stream?.getTracks() || []) track.stop(); this.stream = null; if (this.wakeLock) { void this.wakeLock.release().catch(() => {}); this.wakeLock = null; } }
  destroy() { if (this.recorder && this.recorder.state !== 'inactive') { this.recorder.stop(); } this.release(); }
}
