import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAnalytics} from '../src/analytics/datalayer.ts';
import {observeFetch, observeViews} from '../src/analytics/observe.ts';
import {createGtmSandbox} from '../src/analytics/gtm-sandbox.ts';

/** Exercises real observers and resolves the actual export without contacting Google. */
export async function checkAnalytics(container) {
  container ??= JSON.parse(await readFile(new URL('../analytics/gtm/lifeos-demo-container.json', import.meta.url), 'utf8'));
  const sandbox = createGtmSandbox(container);
  const dataLayer = [], scripts = [], listeners = new Set();
  const analytics = createAnalytics({config: {gtmId: 'GTM-TEST123', ga4Id: 'G-TEST123456'}, origin: 'https://demo.example.test', storage: null, dataLayer,
    loadScript: src => scripts.push(src), now: () => 0});
  let processed = 0, hash = '#school?task=FICTIONAL_PRIVATE_MARKER';
  const flush = () => {for (; processed < dataLayer.length; processed++) sandbox.push(dataLayer[processed]);};
  const views = observeViews({hash: () => hash, origin: () => 'https://demo.example.test', onHashChange: callback => {listeners.add(callback); return () => listeners.delete(callback);}}, analytics);
  // Fictional successful local API responses. Production uses the same observer
  // around the browser workspace, whose API/persistence tests run separately.
  const fetchImpl = observeFetch(async () => new Response('{}', {status: 200}), analytics, 'https://demo.example.test');
  const writeTask = version => fetchImpl('/api/records/task/FICTIONAL_PRIVATE_MARKER', {method: 'PUT', body: JSON.stringify({version, data: {title: 'FICTIONAL_PRIVATE_MARKER'}})});
  const go = view => {hash = view; for (const callback of listeners) callback();};
  try {
    views.report(); await writeTask(0); flush();
    assert.equal(scripts.length, 0, 'No script before consent');
    assert.equal(sandbox.hits.length, 0, 'No pre-consent GA4 events');
    analytics.grant(); flush();
    await writeTask(0); await writeTask(1);
    go('#finances?account=FICTIONAL_PRIVATE_MARKER');
    await fetchImpl('/api/finances/transaction', {method: 'POST', body: '{"description":"FICTIONAL_PRIVATE_MARKER","amountCents":987654321}'});
    go('#today'); go('#today'); flush();
    assert.equal(scripts.length, 1, 'Load GTM once');
    assert.equal(sandbox.configs.length, 1, 'Initialize one Google tag');
    assert.equal(sandbox.configs[0].params.send_page_view, false, 'No automatic duplicate page view');
    assert.deepEqual(sandbox.hits.map(hit => hit.event), ['page_view', 'consent_changed', 'item_created', 'item_updated', 'page_view', 'budget_entry_added', 'page_view']);
    for (const hit of [...sandbox.configs, ...sandbox.hits]) {
      assert.equal(hit.measurementId, 'G-TEST123456');
      assert.equal(hit.params.page_referrer, '');
      assert.ok(/^https:\/\/demo\.example\.test\/(?:#(?:school|finances|today))?$/.test(hit.params.page_location));
    }
    assert.equal(sandbox.hits.find(hit => hit.event === 'item_created').params.item_type, 'task');
    assert.equal(JSON.stringify(sandbox).includes('FICTIONAL_PRIVATE_MARKER'), false, 'No record content in resolved tags');
    assert.equal(JSON.stringify(sandbox).includes('987654321'), false, 'No budget amounts in resolved tags');
    analytics.deny(); flush();
    const before = sandbox.hits.length;
    await writeTask(0); go('#settings'); flush();
    assert.equal(sandbox.hits.length, before, 'No events after withdrawal');
    const counts = Object.fromEntries([...new Set(sandbox.hits.map(hit => hit.event))].map(event => [event, sandbox.hits.filter(hit => hit.event === event).length]));
    return {mode: 'local GTM export simulation; no Google requests', checks: ['pre-consent silence', 'single initialization', 'exported event mapping', 'page-view deduplication', 'safe page metadata', 'record-content exclusion', 'withdrawal silence'], counts, configs: sandbox.configs, events: sandbox.hits};
  } finally {views.stop();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await checkAnalytics();
  await mkdir('.runtime', {recursive: true});
  await writeFile('.runtime/analytics-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${report.checks.length} checks; ${report.events.length} GA4 events resolved from the GTM export.`);
  console.log('Fictional walkthrough: open School, create/edit a task, open Finances, add spending, return to Today.');
  console.log('Counts:', JSON.stringify(report.counts));
  console.log('Local simulation only. No Google requests. Details: .runtime/analytics-check.json');
}
