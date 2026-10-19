import { sha256 } from './recorder.js';
export class FileUploads {
  constructor({ store, request, action }) { Object.assign(this, { store, request, action }); this.running = new Map(); }
  async capture(file, { kind = 'coursework', taskId, title = file.name } = {}) {
    if (!file.size) throw new Error('Choose a file with content.');
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose a file under 50 MB, or keep it in Drive and use its link.');
    const id = crypto.randomUUID(); const chunkSize = 4 * 1024 * 1024; const totalChunks = Math.ceil(file.size / chunkSize);
    const metadata = { id, token: id, mutationId: crypto.randomUUID(), kind, taskId, title: String(title || 'Attachment').slice(0, 300), mimeType: file.type || 'application/octet-stream', totalChunks, size: file.size, state: 'capturing', createdAt: new Date().toISOString() };
    let durable = await this.store.put(`file-upload:${id}`, metadata);
    for (let index = 0; index < totalChunks; index++) {
      const blob = file.slice(index * chunkSize, (index + 1) * chunkSize, metadata.mimeType); const hash = await sha256(blob);
      durable = await this.store.put(`upload:${id}:${String(index).padStart(6, '0')}`, { token: crypto.randomUUID(), sessionId: id, index, blob, hash, mimeType: metadata.mimeType, state: 'not-yet-sent' }) && durable;
    }
    metadata.state = 'not-yet-sent'; metadata.durable = durable; await this.store.put(`file-upload:${id}`, metadata);
    return this.retry(id);
  }
  retry(id) {
    if (this.running.has(id)) return this.running.get(id);
    const task = (async () => {
      const metadata = await this.store.get(`file-upload:${id}`); if (!metadata) throw new Error('This upload has no local recovery manifest.');
      if (metadata.state === 'uploaded') return { item: metadata.item, manifestId: id };
      try {
        for (const { key, value } of (await this.store.list(`upload:${id}:`)).sort((a, b) => a.value.index - b.value.index)) {
          await this.request(`/api/uploads/${id}/${value.index}`, { method: 'POST', body: value.blob, headers: { 'Content-Type': value.mimeType, 'X-Content-SHA256': value.hash, 'X-Mutation-Id': value.token } });
          await this.store.remove(key, value.token);
        }
        const result = await this.action('upload-finalize', { sessionId: id, kind: metadata.kind, mimeType: metadata.mimeType, totalChunks: metadata.totalChunks, title: metadata.title, ...(metadata.taskId ? { taskId: metadata.taskId } : {}), mutationId: metadata.mutationId });
        if (result.pending) return { ...result, manifestId: id };
        await this.store.put(`file-upload:${id}`, { ...metadata, state: 'uploaded', item: result.item }); return { ...result, manifestId: id };
      } catch (error) { await this.store.put(`file-upload:${id}`, { ...metadata, error: error.message }); return { pending: true, manifestId: id, durable: metadata.durable, reason: metadata.durable ? `File not yet saved to the server. ${error.message}` : 'This file is only in memory. Keep this page open until the upload succeeds.' }; }
    })().finally(() => this.running.delete(id)); this.running.set(id, task); return task;
  }
}
