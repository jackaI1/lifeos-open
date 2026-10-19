// Only intentional local drafts and unsent mutations are stored here. API reads are never cached.
export class PrivateStore {
  constructor({ indexedDB = globalThis.indexedDB, storage, name = 'lifeos-open-local-v1' } = {}) {
    this.indexedDB = indexedDB; this.name = name; this.memory = new Map(); this.warning = null;
    try { this.storage = storage ?? globalThis.localStorage; } catch { this.storage = null; }
    this.opening = null; this.serial = Promise.resolve(); this.clock = 0;
  }
  async db() {
    if (!this.indexedDB) throw new Error('Private browser storage is unavailable');
    if (!this.opening) this.opening = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close another LifeOS tab to finish storage setup'));
    });
    return this.opening;
  }
  async operation(mode, fn) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', mode); const request = fn(transaction.objectStore('records'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error('Browser storage was interrupted'));
    });
  }
  enqueue(fn) { const task = this.serial.then(fn, fn); this.serial = task.catch(() => {}); return task; }
  key(key) { return `${this.name}:${key}`; }
  legacyDevotional(date) { try { const value = JSON.parse(this.storage?.getItem(`lifeos:devotional-draft:${date}`) || 'null'); return value?.points?.length === 7 ? value : null; } catch { return null; } }
  removeLegacyDevotional(date, expected) { try { const key = `lifeos:devotional-draft:${date}`; if (JSON.stringify(JSON.parse(this.storage?.getItem(key) || 'null')) === JSON.stringify(expected)) this.storage?.removeItem(key); } catch {} }
  fallback(key) { try { const value = JSON.parse(this.storage?.getItem(this.key(key)) || 'null'); return value?.storageEnvelope === 1 ? value : value ? { value, writtenAt: 0 } : null; } catch { return null; } }
  async latest(key) {
    let database; try { database = await this.operation('readonly', store => store.get(key)); } catch {}
    return [database, this.fallback(key), this.memory.get(key)].filter(Boolean).sort((a, b) => (b.writtenAt || 0) - (a.writtenAt || 0))[0] || null;
  }
  async get(key) {
    await this.serial;
    return structuredClone((await this.latest(key))?.value ?? null);
  }
  // Inspect saved bytes without the memory mirror. Read-only recovery never repairs
  // or removes a conflicting/corrupt candidate. Callers still validate their schema.
  async inspectPhysical(prefix = '') {
    await this.serial; const candidates = [];
    try { for (const row of await this.operation('readonly', store => store.getAll())) if (row?.key?.startsWith(prefix)) candidates.push({backend:'indexedDB',key:row.key,value:structuredClone(row.value),envelope:structuredClone(row),writtenAt:row.writtenAt||0}); } catch {}
    try { for (let index=0;index<(this.storage?.length||0);index++) {
      const physicalKey=this.storage.key(index); if(typeof physicalKey!=='string'||!physicalKey.startsWith(this.key(prefix)))continue;
      const key=physicalKey.slice(this.name.length+1),raw=this.storage.getItem(physicalKey);if(raw==null)continue;
      try { const parsed=JSON.parse(raw);candidates.push({backend:'localStorage',key,value:parsed?.storageEnvelope===1?parsed.value:parsed,writtenAt:parsed?.writtenAt||0,...(parsed?.storageEnvelope===1&&parsed.key!==key?{keyMismatch:true}:{}),raw}); }
      catch { candidates.push({backend:'localStorage',key,raw,parseError:true}); }
    }} catch {}
    return candidates;
  }
  // Memory-backed reads do not prove that a pending decision survived a device save.
  async isDurable(key, expectedToken) {
    await this.serial;
    let database; try { database = await this.operation('readonly', store => store.get(key)); } catch {}
    const persisted = [database, this.fallback(key)].filter(Boolean).sort((a, b) => (b.writtenAt || 0) - (a.writtenAt || 0))[0];
    const memory = this.memory.get(key);
    return !!persisted && (expectedToken === undefined || persisted.value?.token === expectedToken) &&
      (!memory || ((persisted.writtenAt || 0) >= (memory.writtenAt || 0) && (expectedToken === undefined || memory.value?.token === expectedToken)));
  }
  put(key, value) {
    const copy = structuredClone(value); const writtenAt = this.clock = Math.max(Date.now() * 1000, this.clock + 1); const row = { storageEnvelope: 1, key, value: copy, writtenAt }; this.memory.set(key, row);
    return this.enqueue(async () => {
      try { await this.operation('readwrite', store => store.put(row)); const fallback = this.fallback(key); if (!fallback || fallback.writtenAt <= writtenAt) { try { this.storage?.removeItem(this.key(key)); } catch {} } this.warning = null; return true; }
      catch {
        try {
          if (!this.storage || value?.blob instanceof Blob) throw new Error('No fallback storage');
          this.storage.setItem(this.key(key), JSON.stringify(row)); this.warning = null; return true;
        } catch { this.warning = 'This browser cannot keep a durable local copy. Keep this page open until the server confirms your save, or download your writing.'; return false; }
      }
    });
  }
  remove(key, expectedToken) {
    return this.enqueue(async () => {
      const snapshot = await this.latest(key); const existing = snapshot?.value;
      if (expectedToken !== undefined && existing?.token !== expectedToken) return false;
      const cutoff = snapshot?.writtenAt || 0;
      if ((this.memory.get(key)?.writtenAt || 0) <= cutoff) this.memory.delete(key);
      try { await this.operation('readwrite', store => { const request = store.get(key); request.onsuccess = () => { if (request.result && (request.result.writtenAt || 0) <= cutoff) store.delete(key); }; return request; }); } catch {}
      try { const fallback = this.fallback(key); if (!fallback || (fallback.writtenAt || 0) <= cutoff) this.storage?.removeItem(this.key(key)); } catch {}
      return true;
    });
  }
  async list(prefix = '') {
    await this.serial;
    const values = new Map();
    try {
      for (let i = 0; i < (this.storage?.length || 0); i++) {
        const key = this.storage.key(i); if (key.startsWith(this.key(prefix))) { const plain = key.slice(this.name.length + 1); values.set(plain, this.fallback(plain)); }
      }
    } catch {}
    const adopt = (key, row) => { if (!values.get(key) || (row.writtenAt || 0) >= (values.get(key).writtenAt || 0)) values.set(key, row); };
    try { for (const row of await this.operation('readonly', store => store.getAll())) if (row.key.startsWith(prefix)) adopt(row.key, row); } catch {}
    for (const [key, row] of this.memory) if (key.startsWith(prefix)) adopt(key, row);
    return [...values].filter(([, row]) => row).map(([key, row]) => ({ key, value: row.value }));
  }
}

export class MutationOutbox {
  constructor(store, send, changed = () => {}) { this.store = store; this.send = send; this.changed = changed; this.flushing = null; }
  async submit(path, body, method = 'POST') {
    const token = body.mutationId || crypto.randomUUID(); const item = { path, method, body: { ...body, mutationId: token }, token, createdAt: new Date().toISOString(), state: 'not-yet-sent' };
    const durable = await this.store.put(`outbox:${token}`, item);
    try { const result = await this.send(path, { method, body: item.body }); await this.store.remove(`outbox:${token}`, token); this.changed(); return result; }
    catch (error) {
      if (error.status && error.status !== 401 && error.status !== 503 && error.status !== 502 && error.status !== 504 && error.status !== 429) {
        item.state = error.status === 409 ? 'conflict' : 'needs-review'; item.error = error.message; await this.store.put(`outbox:${token}`, item); this.changed(); throw error;
      }
      this.changed(); return { pending: true, durable, mutationId: token, reason: !durable ? 'Not yet sent, and browser storage failed. Keep this page open and download your writing before closing.' : error.status === 401 ? 'Sign in again to send this request.' : 'Not yet sent. It will retry when the connection returns.' };
    }
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      for (const { key, value } of await this.store.list('outbox:')) {
        if(value.path==='/api/actions/upload-finalize'&&['conflict','needs-review'].includes(value.state)&&/finaliz/i.test(value.error||'')){
          try{const b=value.body,receipt=await this.send('/api/actions/upload-reconcile',{method:'POST',body:{sessionId:b.sessionId,kind:b.kind,totalChunks:b.totalChunks}});if(receipt.reconciled&&receipt.sessionId===b.sessionId){const preserved=await this.store.put('recovery:finalized:'+value.token,{...value,reconciledAt:new Date().toISOString(),receipt});if(preserved)await this.store.remove(key,value.token);}}catch{}
          continue;
        }
        if (value.state !== 'not-yet-sent') continue;
        try { await this.send(value.path, { method: value.method, body: value.body }); await this.store.remove(key, value.token); }
        catch (error) { if (error.status === 409 || (error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429)) await this.store.put(key, { ...value, state: 'needs-review', error: error.message }); else break; }
      }
      this.changed();
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
