import type {Analytics} from '../datalayer.ts';
import {analyze} from './analysis.ts';
import {createExperiment, type ExperimentStorage} from './controller.ts';

/** Only the browser-demo bootstrap calls this; the standalone app never does. */
export async function mountExperiment(win: Window & typeof globalThis, analytics: Analytics, storage: ExperimentStorage | null) {
  const doc = win.document;
  const enabled = doc.querySelector('meta[name="lifeos-experiment-task-entry"]')?.getAttribute('content') !== 'off';
  let refresh = () => {};
  const experiment = await createExperiment({consent: analytics, storage, enabled, changed: () => refresh()});
  const buttons = new Set<HTMLButtonElement>();
  const visible = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    return doc.visibilityState === 'visible' && !button.disabled && button.isConnected && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth && win.getComputedStyle(button).visibility === 'visible';
  };
  refresh = () => {
    for (const button of buttons) {
      if (!button.isConnected) {intersection.unobserve(button); buttons.delete(button); continue;}
      if (button.textContent !== experiment.label()) button.textContent = experiment.label();
      if (visible(button)) experiment.expose();
    }
  };
  const intersection = new win.IntersectionObserver(() => refresh());
  const scan = () => {
    for (const button of doc.querySelectorAll<HTMLButtonElement>('[data-task-entry-experiment]')) {
      if (!buttons.has(button)) {buttons.add(button); intersection.observe(button);}
    }
    refresh();
  };
  const mutations = new win.MutationObserver(scan);
  mutations.observe(doc.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style']});
  doc.addEventListener('visibilitychange', refresh);
  const onStorage = (event: StorageEvent) => {if (event.key === 'lifeos-experiment-task-entry-v1') void experiment.refresh().catch(() => {});};
  win.addEventListener('storage', onStorage);
  scan();

  const reportButton = doc.createElement('button');
  reportButton.type = 'button'; reportButton.className = 'analytics-consent-reopen experiment-report-button';
  reportButton.textContent = 'Task label experiment';
  const dialog = doc.createElement('dialog'); dialog.className = 'experiment-report';
  dialog.setAttribute('aria-label', 'Task label experiment report');
  const title = doc.createElement('h2'); title.textContent = 'Task label experiment';
  const explanation = doc.createElement('p');
  explanation.textContent = 'I compare “New task” with “Plan a task” in Academics. Counts stay in this browser and wait for analytics consent. One browser cannot establish a winner. The planned final analysis needs 1,094 browsers per version, then one comparison after the 24-hour outcome window.';
  const report = doc.createElement('pre');
  const download = doc.createElement('button'); download.type = 'button'; download.textContent = 'Download this browser’s counts';
  download.addEventListener('click', () => {
    const href = win.URL.createObjectURL(new Blob([JSON.stringify(experiment.counts(), null, 2)+'\n'], {type: 'application/json'}));
    const link = doc.createElement('a'); link.href = href; link.download = 'lifeos-task-experiment-counts.json'; link.click();
    win.setTimeout(() => win.URL.revokeObjectURL(href), 0);
  });
  const close = doc.createElement('button'); close.type = 'button'; close.textContent = 'Close report'; close.addEventListener('click', () => dialog.close());
  dialog.append(title, explanation, report, download, close); doc.body.append(dialog);
  reportButton.addEventListener('click', () => {
    const result = analyze(experiment.counts());
    report.textContent = `${enabled ? 'Enabled' : 'Disabled'}; this browser: ${experiment.label()}\n${result.status}\nControl: ${result.control.conversions}/${result.control.exposures}\nTreatment: ${result.treatment.conversions}/${result.treatment.exposures}`;
    dialog.showModal();
  });
  // Keep the report available even after declining. It then contains zero events.
  doc.body.append(reportButton);
  return {
    experiment,
    wrapFetch<F extends (input: any, init?: any) => Promise<Response>>(fetchImpl: F): F {
      return (async (input: any, init?: any) => {
        const finish = experiment.beginOutcome();
        const response = await fetchImpl(input, init);
        try {
          const request = input instanceof win.Request ? input : null;
          const url = new URL(request?.url ?? String(input), win.location.origin);
          const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
          // The app sends JSON string bodies. Ignore unclassified bodies and queued saves.
          if (url.origin === win.location.origin && /^\/api\/records\/task\/[^/]+$/.test(url.pathname) && method === 'PUT' && typeof init?.body === 'string' && JSON.parse(init.body).version === 0 && response.ok && response.status !== 202) {
            const body = await response.clone().json();
            finish(body?.pending !== true && body?.ok !== false);
          }
        } catch { /* Measurement never interrupts a workspace operation. */ }
        return response;
      }) as F;
    },
    stop() {experiment.stop(); mutations.disconnect(); intersection.disconnect(); doc.removeEventListener('visibilitychange', refresh); win.removeEventListener('storage', onStorage); reportButton.remove(); dialog.remove();}
  };
}
