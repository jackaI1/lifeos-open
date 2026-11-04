/**
 * Builds the importable Power Automate solution package from definition.json.
 *
 *   node integrations/m365/flow/pack.ts
 *
 * The output is deterministic (fixed ids and timestamps), so the committed .zip can be checked
 * against a rebuild in tests.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {crc32, deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const SOLUTION_NAME = 'LifeOSDueTomorrowReminder';
export const SOLUTION_VERSION = '1.0.0.0';
export const ZIP_NAME = `${SOLUTION_NAME}_${SOLUTION_VERSION.replaceAll('.', '_')}.zip`;
const WORKFLOW_ID = '7c1e9f4a-3b52-4d6e-8a10-5e2f4c9b0d11';
const DISPLAY_NAME = 'LifeOS due-tomorrow reminder';
const CONNECTORS = ['shared_sharepointonline', 'shared_teams', 'shared_office365'];

const xml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;

function workflowJson(definition: unknown): string {
  const connectionReferences = Object.fromEntries(
    CONNECTORS.map((name) => [name, {runtimeSource: 'embedded', connection: {}, api: {name}}]),
  );
  return JSON.stringify({properties: {connectionReferences, definition, templateName: null}, schemaVersion: '1.0.0.0'}, null, 2) + '\n';
}

export function solutionFiles(definition: unknown): Record<string, string> {
  const workflowPath = `Workflows/${SOLUTION_NAME}-${WORKFLOW_ID.toUpperCase()}.json`;
  const names = (language = '1033') => `<LocalizedNames><LocalizedName description="${DISPLAY_NAME}" languagecode="${language}" /></LocalizedNames>`;
  return {
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/octet-stream" /><Default Extension="json" ContentType="application/octet-stream" /></Types>',
    ),
    'solution.xml': xml(
      `<ImportExportXml version="9.2.0.0" SolutionPackageVersion="9.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<SolutionManifest><UniqueName>${SOLUTION_NAME}</UniqueName>${names()}<Descriptions />` +
        `<Version>${SOLUTION_VERSION}</Version><Managed>0</Managed>` +
        `<Publisher><UniqueName>lifeosopen</UniqueName><LocalizedNames><LocalizedName description="LifeOS Open" languagecode="1033" /></LocalizedNames><Descriptions />` +
        `<EMailAddress xsi:nil="true" /><SupportingWebsiteUrl xsi:nil="true" /><CustomizationPrefix>lifeos</CustomizationPrefix><CustomizationOptionValuePrefix>48213</CustomizationOptionValuePrefix><Addresses /></Publisher>` +
        `<RootComponents><RootComponent type="29" id="{${WORKFLOW_ID}}" behavior="0" /></RootComponents><MissingDependencies /></SolutionManifest></ImportExportXml>`,
    ),
    'customizations.xml': xml(
      `<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Entities></Entities><Roles></Roles><Workflows>` +
        `<Workflow WorkflowId="{${WORKFLOW_ID}}" Name="${DISPLAY_NAME}"><JsonFileName>/${workflowPath}</JsonFileName>` +
        `<Type>1</Type><Subprocess>0</Subprocess><Category>5</Category><Mode>0</Mode><Scope>4</Scope><OnDemand>0</OnDemand>` +
        `<TriggerOnCreate>0</TriggerOnCreate><TriggerOnDelete>0</TriggerOnDelete><AsyncAutodelete>0</AsyncAutodelete>` +
        `<SyncWorkflowLogOnFailure>0</SyncWorkflowLogOnFailure><StateCode>0</StateCode><StatusCode>1</StatusCode><RunAs>1</RunAs>` +
        `<IsTransacted>1</IsTransacted><IntroducedVersion>1.0</IntroducedVersion><IsCustomizable>1</IsCustomizable><BusinessProcessType>0</BusinessProcessType>` +
        `<PrimaryEntity>none</PrimaryEntity>${names()}<Descriptions /></Workflow></Workflows>` +
        `<FieldSecurityProfiles></FieldSecurityProfiles><Templates /><EntityMaps /><EntityRelationships /><OrganizationSettings /><optionsets /><CustomControls /><EntityDataProviders /><Languages><Language>1033</Language></Languages></ImportExportXml>`,
    ),
    [workflowPath]: workflowJson(definition),
  };
}

/** Minimal deterministic ZIP writer (deflate, fixed 2026-01-01 timestamp). */
export function zip(files: Record<string, string>): Buffer {
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw, {level: 9});
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildSolutionZip(): Buffer {
  const definition = JSON.parse(readFileSync(join(here, 'definition.json'), 'utf8'));
  return zip(solutionFiles(definition));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = join(here, ZIP_NAME);
  writeFileSync(target, buildSolutionZip());
  console.log(`Wrote ${target}`);
}
