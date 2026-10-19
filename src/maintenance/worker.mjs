import { randomUUID } from 'node:crypto';

/** Separate process adapter. The ordinary record worker never calls this. */
export async function runMaintenanceWorker({ store, stores, pipeline, prepareRelease, signal, intervalMs = 5000, once = false }) {
  const worker = `maintenance-${randomUUID()}`;
  const queues = stores ?? [{ store, environment: 'production' }];
  if (!Array.isArray(queues) || !queues.length || queues.length > 2 || queues.some(q => !q.store || !['production','beta'].includes(q.environment)) || new Set(queues.map(q=>q.environment)).size !== queues.length || new Set(queues.map(q=>q.store)).size !== queues.length) throw new Error('Explicit distinct maintenance job stores are required');
  let cursor = 0;
  await pipeline.initialize();
  while (!signal?.aborted) {
    const paused = queues.find(q=>q.environment==='production')?.store.meta('automationPaused') || queues.some(q=>q.store.meta('maintenancePaused'));
    for (const queue of queues) queue.store.heartbeat('maintenance', { status: paused || queue.store.meta('automationPaused') ? 'paused' : 'idle' });
    let selected, job;
    for (let offset=0;offset<queues.length;offset++) {
      const index=(cursor+offset)%queues.length,queue=queues[index];
      if(paused||queue.store.meta('automationPaused'))continue;
      const claimed=queue.store.claim(worker,{types:queue.environment==='beta'?['maintenance']:['maintenance','maintenance-release']});
      if(claimed){selected=queue;job=claimed;cursor=(index+1)%queues.length;break;}
    }
    if (job) {
      const store = selected.store;
      const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
      const lease = setInterval(() => {
        if (signal?.aborted || store.job(job.id)?.cancelRequested) controller.abort();
        else if (!store.lease(job.id, worker, 'Maintenance is running in its isolated worktree')) controller.abort();
      }, 10000);
      try {
        const progress = text => store.lease(job.id, worker, text);
        const prepared = job.type === 'maintenance-release' ? await (prepareRelease ? prepareRelease(job, { signal: controller.signal, progress }) : Promise.reject(new Error('The trusted release preparer is not configured'))) : null;
        const result = job.type === 'maintenance'
          ? await pipeline.runJob(job, { signal: controller.signal, onProgress: progress => store.lease(job.id, worker, progress) })
          : await pipeline.releaseAction({ ...prepared, id: job.id, authority: job.authority }, { signal: controller.signal });
        if (!controller.signal.aborted) {
          store.transaction(() => {
          const finished = store.finish(job.id, worker, result);
          if (finished && store.job(job.id)?.status === 'completed' && result.releaseId) {
            store.upsertInternal('release', result.releaseId, { ...result, dataMigration: 'none' }, 'maintenance-controller');
            if (job.type === 'maintenance') {
              const id = `maintenance-${job.id}`, deployed = result.status === 'deployed' || result.status === 'beta-ready-for-owner-test';
              const betaOrigin = pipeline.config?.targets?.beta?.origin;
              if (!store.get('notification',id)) store.upsertInternal('notification',id,{message:deployed?'A beta update is ready for your review.':'The update passed local checks and is waiting for beta deployment.',route:'support',...(deployed&&betaOrigin?{url:betaOrigin}:{}),releaseId:result.releaseId,status:'unread',createdAt:new Date().toISOString(),sourceJobId:job.id},'maintenance-controller');
            }
          }
          });
          // In-app status only. No email, message or external notification is sent here.
          store.heartbeat('maintenance', { status: result.status, releaseId: result.releaseId ?? null }, true);
        } else store.fail(job.id, worker, 'Maintenance cancelled');
      } catch (error) { store.fail(job.id, worker, error.message, { usageLimited: error.code === 'usage_limited', needsInput: !['usage_limited','cancelled','process_failed'].includes(error.code) }); }
      finally { clearInterval(lease); signal?.removeEventListener('abort', abort); }
    }
    if (once) return;
    await new Promise(resolve => {
      const timer = setTimeout(done, intervalMs);
      function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
