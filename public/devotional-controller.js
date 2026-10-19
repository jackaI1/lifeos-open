export const PROMPTS = ['What does this passage say?', 'What did this passage mean to its original audience?', 'What does this passage tell us about God?', 'What does this passage tell us about man?', 'What does this passage demand of me?', 'How does this passage change the way I relate to people?', 'How does this passage prompt me to pray?'];
export const blankEntry = (date,id=date) => ({ id,date, passage: '', points: Array(7).fill(''), complete: false, version: 0, updatedAt: null });
export class DevotionalController {
  constructor({ request, store, changed = () => {}, delay = 1000 }) { this.request = request; this.store = store; this.changed = changed; this.delay = delay; this.entries = new Map(); this.activeDate = null; this.loadId = 0; this.destroyed = false; }
  notify(type, record, extra = {}) { if (!this.destroyed) this.changed({ type, record, active: this.activeDate === (record?.entry.id??record?.entry.date), ...extra }); }
  async load(date,id=date,{suggestedPassage=null}={}) {
    const loadId = ++this.loadId; const previous = this.entries.get(id);
    this.notify('loading', previous);
    let remote; let loadError;
    try { remote = (await this.request(`/api/devotionals/${encodeURIComponent(id)}?day=${date}`)).entry; }
    catch (error) { loadError = error; }
    if(remote&&!remote.version&&!remote.bookId&&!remote.points?.some(p=>p.trim())&&suggestedPassage)remote={...remote,...suggestedPassage};
    let draft = await this.store.get(`draft:devotional:${id}`); let legacy = null;
    if (!draft && id===date) { const old = this.store.legacyDevotional?.(date); if (old) { legacy = old; draft = { token: crypto.randomUUID(), entry: { ...blankEntry(date,id), ...old, date } }; if (await this.store.put(`draft:devotional:${id}`, draft)) { this.store.removeLegacyDevotional?.(date, old); legacy = null; } } }
    if (loadId !== this.loadId || this.destroyed) return false;
    let record = this.entries.get(id);
    if (!remote && !draft && !record) { this.notify('load-error', record, { error: loadError }); return false; }
    if (!record || (!record.dirty && !record.pending)) {
      record = { entry: structuredClone(remote || draft?.entry || blankEntry(date,id)), seq: 0, dirty: false, pending: null, timer: null, conflict: null, token: null, retry: draft?.retry || null, legacy };
      if (draft) {
        record.draft = draft; record.token = draft.token;
        if (!remote || draft.retry || draft.entry.version === remote.version) { record.entry = structuredClone(draft.entry); record.dirty = true; record.seq = 1; }
        else if (JSON.stringify(draft.entry.points) !== JSON.stringify(remote.points) || ['passage','bookId','chapter','chapterEnd','complete','plan','context','schoolMinutes','type','customText'].some(key=>(draft.entry[key]??null)!==(remote[key]??null)) || (draft.entry.observedAt&&Date.parse(draft.entry.observedAt)!==Date.parse(remote.completedAt))) record.conflict = { current: remote, draft: draft.entry };
        else await this.store.remove(`draft:devotional:${id}`, draft.token);
      }
      this.entries.set(id, record);
    } else if (remote && remote.version > record.entry.version && !record.pending) record.conflict = { current: remote, draft: structuredClone(record.entry) };
    record.entry.id=id; this.activeDate = id; this.notify('loaded', record, { offline: !!loadError });
    if (record.dirty && !record.conflict) this.schedule(record);
    return true;
  }
  edit(values) {
    const record = this.entries.get(this.activeDate); if (!record) return;
    record.entry = { ...record.entry, ...values, points: [...(values.points || record.entry.points)] };
    record.seq += 1; record.token = crypto.randomUUID(); record.dirty = true; record.draft = null;
    this.schedule(record); // Storage exceptions must never cancel the server save.
    void this.persist(record); this.notify('edited', record);
  }
  async persist(record) {
    let durable = false;const token=record.token;
    try { durable = await this.store.put(`draft:devotional:${record.entry.id??record.entry.date}`, { token: record.token, entry: structuredClone(record.entry), retry: record.retry || null, savedAt: new Date().toISOString() }); } catch {}
    if(record.token===token){record.storageError=!durable;if(durable)record.localSavedToken=token;}
    if (!durable) this.notify('storage-error', record);
    else this.notify('local-saved',record);
    if (durable && record.legacy) { this.store.removeLegacyDevotional?.(record.entry.date, record.legacy); record.legacy = null; }
  }
  schedule(record, delay = this.delay) { clearTimeout(record.timer); if (!record.conflict && !this.destroyed) record.timer = setTimeout(() => { void this.save(record.entry.id??record.entry.date); }, delay); }
  async save(date = this.activeDate, { archive = false } = {}) {
    const record = this.entries.get(date); if (!record || record.conflict) return;
    if(archive){if(record.pending)await record.pending;if(record.conflict)return;if(record.retry){await this.save(date);if(record.retry||record.conflict)return;}record.dirty=true;record.token=crypto.randomUUID();record.seq++;}
    if(!record.dirty)return;
    clearTimeout(record.timer); if (record.pending) return record.pending;
    const snapshot = record.retry || { entry: structuredClone(record.entry), seq: record.seq, token: record.token, mutationId: crypto.randomUUID(), archiveRequested: archive };
    record.retry = snapshot;
    this.notify('saving', record);
    record.pending = (async () => {
      try {
        await this.persist(record);
        const { entry: saved } = await this.request(`/api/devotionals/${encodeURIComponent(date)}`, { method: 'PUT', body: { ...snapshot.entry, archiveRequested: snapshot.archiveRequested === true, mutationId: snapshot.mutationId } });
        // This record object belongs to the date across every visit. A response never repaints inputs.
        record.entry.version = saved.version; record.entry.updatedAt = saved.updatedAt; record.entry.archiveStatus = saved.archiveStatus;
        record.retry = null;
        if (record.token === snapshot.token) { record.dirty = false; record.entry.complete = saved.complete; record.entry.completedAt = saved.completedAt; await this.store.remove(`draft:devotional:${date}`, snapshot.token); this.notify('saved', record); }
        else { await this.persist(record); this.notify('edited', record); }
        return saved;
      } catch (error) {
        if (error.status === 409) { record.retry = null; record.conflict = { current: error.current?.entry || error.current, draft: structuredClone(record.entry) }; this.notify('conflict', record, { error }); }
        else this.notify('save-error', record, { error });
      } finally { record.pending = null; if (record.dirty && !record.conflict && !record.retry && record.token !== snapshot.token) this.schedule(record, 250); }
    })();
    return record.pending;
  }
  async resolve(useDraft) {
    const record = this.entries.get(this.activeDate); if (!record?.conflict) return;
    let current = record.conflict.current;
    if (!current?.points) current = (await this.request(`/api/devotionals/${encodeURIComponent(this.activeDate)}`)).entry;
    const draft = record.conflict.draft || record.draft?.entry || record.entry;
    record.conflict = null;
    record.retry = null;
    if (useDraft) { record.entry = { ...structuredClone(draft), version: current.version, updatedAt: current.updatedAt }; record.seq += 1; record.token = crypto.randomUUID(); record.dirty = true; await this.persist(record); }
    else { await this.store.put(`recovery:devotional:${this.activeDate}:${Date.now()}`, { token: crypto.randomUUID(), entry: structuredClone(draft) }); await this.store.remove(`draft:devotional:${this.activeDate}`, record.token); record.entry = structuredClone(current); record.dirty = false; }
    this.notify('loaded', record); // Explicit user resolution may replace the editor, never an automatic save.
    if (useDraft) this.schedule(record);
  }
  dirty() { return [...this.entries.values()].some(record => record.dirty || record.pending); }
  destroy() { this.destroyed = true; this.loadId += 1; for (const record of this.entries.values()) { clearTimeout(record.timer); if (record.dirty && !record.conflict) void this.save(record.entry.id??record.entry.date); } }
}
