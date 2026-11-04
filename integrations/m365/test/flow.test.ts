import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSolutionZip, ZIP_NAME, SOLUTION_NAME} from '../flow/pack.ts';
import {MANAGED_FIELDS, STATUS_LABELS} from '../src/mapping.ts';

const flowDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'flow');
const definition = JSON.parse(readFileSync(join(flowDir, 'definition.json'), 'utf8'));
const raw = readFileSync(join(flowDir, 'definition.json'), 'utf8');

/** Reads the central directory of a ZIP into name → contents. */
function unzip(buffer: Buffer): Record<string, string> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const size = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extra = buffer.readUInt16LE(pointer + 30) + buffer.readUInt16LE(pointer + 32);
    const local = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString();
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    out[name] = inflateRawSync(buffer.subarray(start, start + size)).toString();
    pointer += 46 + nameLength + extra;
  }
  return out;
}

function walk(actions: Record<string, any>, visit: (name: string, action: any) => void) {
  for (const [name, action] of Object.entries(actions)) {
    visit(name, action);
    if (action.actions) walk(action.actions, visit);
    if (action.else?.actions) walk(action.else.actions, visit);
  }
}

test('flow runs daily and only reads the synced list', () => {
  const trigger = Object.values(definition.triggers)[0] as any;
  assert.equal(trigger.type, 'Recurrence');
  assert.equal(trigger.recurrence.frequency, 'Day');
  const get = definition.actions.Get_open_tasks.inputs;
  assert.equal(get.host.operationId, 'GetItems');
  for (const label of [STATUS_LABELS.done, STATUS_LABELS.archived]) assert.ok(get.parameters.$filter.includes(`'${label}'`), label);
});

test('every column the flow reads is one the sync writes', () => {
  const fields = [...raw.matchAll(/items?\((?:'[^']*')?\)\?\['(\w+)'\]/g)].map((m) => m[1]);
  assert.ok(fields.length >= 5, 'expected the flow to reference list columns');
  for (const field of fields) assert.ok(MANAGED_FIELDS.includes(field), field);
  assert.ok(raw.includes("items('For_each_due_item')?['Title']"));
});

test('runAfter references resolve and no action name is duplicated', () => {
  const names: string[] = [];
  walk(definition.actions, (name) => names.push(name));
  assert.equal(new Set(names).size, names.length);
  walk(definition.actions, (name, action) => {
    for (const dependency of Object.keys(action.runAfter ?? {})) {
      assert.ok(names.includes(dependency), `${name} runs after missing ${dependency}`);
    }
  });
  for (const [, reference] of raw.matchAll(/(?:outputs|body)\('(\w+)'\)/g)) assert.ok(names.includes(reference), `unknown action ${reference}`);
});

test('Teams and Outlook reminders are sent for each due item', () => {
  const operations: string[] = [];
  walk(definition.actions, (_, action) => action.inputs?.host && operations.push(action.inputs.host.operationId));
  assert.deepEqual(operations.sort(), ['GetItems', 'PostMessageToConversation', 'SendEmailV2']);
});

test('placeholders are visibly fake and the package carries no tenant identifiers', () => {
  const settings = definition.actions.Settings.inputs;
  assert.match(settings.siteUrl, /YOUR-TENANT/);
  assert.match(settings.recipientEmail, /@example\.com$/);
  assert.doesNotMatch(raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*tenant/i);
});

test('the solution package has the files Power Automate expects and wraps the definition', () => {
  const files = unzip(buildSolutionZip());
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', 'Workflows/LifeOSDueTomorrowReminder-7C1E9F4A-3B52-4D6E-8A10-5E2F4C9B0D11.json', 'customizations.xml', 'solution.xml'].sort());
  assert.match(files['solution.xml'], new RegExp(`<UniqueName>${SOLUTION_NAME}</UniqueName>`));
  assert.match(files['solution.xml'], /RootComponent type="29" id="\{7c1e9f4a-3b52-4d6e-8a10-5e2f4c9b0d11\}"/);
  assert.match(files['customizations.xml'], /<StateCode>0<\/StateCode>/); // imports switched off until connections are set
  const workflow = JSON.parse(files['Workflows/LifeOSDueTomorrowReminder-7C1E9F4A-3B52-4D6E-8A10-5E2F4C9B0D11.json']);
  assert.deepEqual(workflow.properties.definition, definition);
  assert.deepEqual(Object.keys(workflow.properties.connectionReferences).sort(), ['shared_office365', 'shared_sharepointonline', 'shared_teams']);
});

test('the committed zip is exactly what the packer builds from definition.json', () => {
  assert.ok(readFileSync(join(flowDir, ZIP_NAME)).equals(buildSolutionZip()), `run node integrations/m365/flow/pack.ts to refresh ${ZIP_NAME}`);
});
