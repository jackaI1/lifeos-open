import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkAnalytics} from '../tools/analytics-check.mjs';
import {createGtmSandbox} from '../src/analytics/gtm-sandbox.ts';
import {createAnalytics} from '../src/analytics/datalayer.ts';
import {observeFetch} from '../src/analytics/observe.ts';

const load = async () => JSON.parse(await readFile(new URL('../analytics/gtm/lifeos-demo-container.json', import.meta.url), 'utf8'));
const parameter = (tag, key) => tag.parameter.find(p => p.key === key);

test('the real event observers and exported GTM tags produce the complete fictional walkthrough', async () => {
  const report = await checkAnalytics();
  assert.deepEqual(report.counts, {page_view: 3, consent_changed: 1, item_created: 1, item_updated: 1, budget_entry_added: 1});
  assert.equal(report.checks.length, 7);
  const task = report.events.find(e => e.event === 'item_created');
  assert.equal(task.params.page_location, 'https://demo.example.test/#school');
  const budget = report.events.find(e => e.event === 'budget_entry_added');
  assert.equal(budget.params.page_location, 'https://demo.example.test/#finances');
});

test('the check fails if the exported page-view mapping is broken', async () => {
  const doc = await load();
  parameter(doc.containerVersion.tag.find(t => t.name.endsWith('view_changed')), 'eventName').value = 'wrong_event';
  await assert.rejects(checkAnalytics(doc), /page_view/);
});

test('the check fails if an export starts automatic page views', async () => {
  const doc = await load();
  const table = parameter(doc.containerVersion.tag.find(t => t.type === 'googtag'), 'configSettingsTable');
  table.list.find(row => row.map[0].value === 'send_page_view').map[1].value = 'true';
  await assert.rejects(checkAnalytics(doc), /No automatic duplicate page view/);
});

test('the check fails if a tag loses its measurement destination', async () => {
  const doc = await load();
  parameter(doc.containerVersion.tag.find(t => t.type === 'gaawe'), 'measurementIdOverride').value = '';
  await assert.rejects(checkAnalytics(doc), /Missing GA4 destination/);
});

test('the check detects unsafe metadata in the export itself', async () => {
  const doc = await load();
  const table = parameter(doc.containerVersion.tag.find(t => t.type === 'gaawe'), 'eventSettingsTable');
  table.list.find(row => row.map[0].value === 'page_referrer').map[1].value = 'https://private.example.test';
  await assert.rejects(checkAnalytics(doc));
});

test('the sandbox rejects unknown tags, variables, triggers and absent consent gates', async () => {
  const mutations = [
    [doc => {doc.containerVersion.tag[0].type = 'html';}, /Unsupported GTM tag/],
    [doc => {doc.containerVersion.variable[0].type = 'jsm';}, /Unsupported GTM variable/],
    [doc => {doc.containerVersion.trigger[0].type = 'CLICK';}, /Unsupported GTM trigger/],
    [doc => {doc.containerVersion.tag[0].firingTriggerId = ['missing'];}, /Unknown GTM trigger/],
    [doc => {doc.containerVersion.tag[0].consentSettings.consentStatus = 'NOT_NEEDED';}, /Missing analytics consent/],
    [doc => {parameter(doc.containerVersion.tag[0], 'tagId').value = '{{missing}}';}, /Unknown GTM variable/],
  ];
  for (const [mutate, pattern] of mutations) {
    const doc = await load(); mutate(doc);
    assert.throws(() => createGtmSandbox(doc), pattern);
  }
});

test('the sandbox respects all extra tag consent requirements', async () => {
  const doc = await load();
  doc.containerVersion.tag[0].consentSettings.consentType.list.push({type: 'TEMPLATE', value: 'ad_storage'});
  const sandbox = createGtmSandbox(doc);
  sandbox.push(['consent', 'default', {analytics_storage: 'granted', ad_storage: 'denied'}]);
  sandbox.push({ga4_measurement_id: 'G-TEST123456', event: 'gtm.js'});
  assert.equal(sandbox.configs.length, 0);
});

test('an action started without consent is not counted after consent changes while waiting', async () => {
  const dataLayer = [];
  const analytics = createAnalytics({config: {gtmId: 'GTM-TEST123'}, dataLayer, storage: null, loadScript() {}});
  let finish;
  const fetchImpl = observeFetch(() => new Promise(resolve => {finish = resolve;}), analytics, 'https://demo.test');
  const response = fetchImpl('/api/records/task/fictional', {method: 'PUT', body: '{"version":0}'});
  analytics.grant();
  finish(new Response('{}'));
  await response;
  assert.equal(dataLayer.some(e => e.event === 'item_created'), false);
});

test('withdrawing consent while a write is pending suppresses its event', async () => {
  const dataLayer = [];
  const analytics = createAnalytics({config: {gtmId: 'GTM-TEST123'}, dataLayer, storage: null, loadScript() {}});
  analytics.grant();
  let finish;
  const fetchImpl = observeFetch(() => new Promise(resolve => {finish = resolve;}), analytics, 'https://demo.test');
  const response = fetchImpl('/api/records/task/fictional', {method: 'PUT', body: '{"version":0}'});
  analytics.deny(); finish(new Response('{}'));
  await response;
  assert.equal(dataLayer.some(e => e.event === 'item_created'), false);
});
