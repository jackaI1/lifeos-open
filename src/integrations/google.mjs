import { OAuth2Client } from 'google-auth-library';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { protect as protectSecret, unprotect as unprotectSecret } from '../server/secrets.mjs';
import { assertPersonalCalendarWrite } from '../domain/calendar.mjs';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DOCS = 'https://docs.googleapis.com/v1/documents';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const DOCUMENT = 'application/vnd.google-apps.document';
const FILE_FIELDS = 'id,name,mimeType,parents,appProperties,owners(emailAddress),permissions(id,type,role,emailAddress,domain),shared,trashed,capabilities(canEdit,canCopy),size,md5Checksum,webViewLink,modifiedTime';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) && !Buffer.isBuffer(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const id = value => { if (typeof value !== 'string' || !/^[\w@.\-]+$/.test(value) || value.length > 300) throw new GoogleIntegrationError('Invalid provider identifier', 'invalid_input'); return encodeURIComponent(value); };
const text = (value, max = 500_000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new GoogleIntegrationError('Missing or oversized content', 'invalid_input'); return value; };
const qString = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const sourceId = value => typeof value === 'string' ? value : value?.id ?? value?.fileId;

export class GoogleIntegrationError extends Error {
  constructor(message, code = 'google_failed', status = null) { super(message); this.name = 'GoogleIntegrationError'; this.code = code; this.status = status; }
}

async function jsonFile(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

function documentTabs(document) {
  const result = [];
  const visit = (tabs, parent = null) => {
    for (const tab of tabs ?? []) {
      result.push({ id: tab.tabProperties?.tabId, title: tab.tabProperties?.title ?? '', parent, data: tab.documentTab ?? {} });
      visit(tab.childTabs, tab.tabProperties?.tabId);
    }
  };
  visit(document.tabs);
  if (!result.length && document.body) result.push({ id: undefined, title: '', parent: null, data: document });
  return result;
}

function atoms(content = []) {
  const result = [];
  const visit = items => {
    for (const item of items ?? []) {
      for (const element of item.paragraph?.elements ?? []) {
        if (element.textRun) result.push({ start: element.startIndex, end: element.endIndex, text: element.textRun.content ?? '' });
        else result.push({ start: element.startIndex, end: element.endIndex, native: Object.fromEntries(Object.entries(element).filter(([key]) => !['startIndex', 'endIndex'].includes(key))) });
      }
      if (item.table) {
        result.push({ start: item.startIndex, end: item.endIndex, structure: { table: true, rows: item.table.rows, columns: item.table.columns } });
        for (const row of item.table.tableRows ?? []) for (const cell of row.tableCells ?? []) visit(cell.content);
      }
      if (item.tableOfContents) { result.push({ structure: 'table-of-contents' }); visit(item.tableOfContents.content); }
    }
  };
  visit(content); return result;
}

function rangeText(tab, range) {
  let result = '';
  for (const atom of atoms(tab.data.body?.content)) {
    if (atom.start == null || atom.end <= range.startIndex || atom.start >= range.endIndex) continue;
    if (atom.native || atom.structure) throw new GoogleIntegrationError('A native control appears inside the managed entry. Review it before editing.', 'document_conflict');
    result += atom.text.slice(Math.max(0, range.startIndex - atom.start), Math.min(atom.text.length, range.endIndex - atom.start));
  }
  return result;
}

function fingerprint(document, excluded = null) {
  return hash(canonical(documentTabs(document).map(tab => ({ title: tab.title, depth: (() => { let p = tab.parent, count = 0; const tabs = documentTabs(document); while (p) { count++; p = tabs.find(t => t.id === p)?.parent; } return count; })(), content: atoms(tab.data.body?.content).map(atom => {
    if (!excluded || excluded.tabId !== tab.id || atom.start == null || atom.end <= excluded.startIndex || atom.start >= excluded.endIndex) return atom.text ?? atom.native ?? atom.structure;
    if (atom.native || atom.structure) return null;
    return atom.text.slice(0, Math.max(0, excluded.startIndex - atom.start)) + atom.text.slice(Math.max(0, excluded.endIndex - atom.start));
  }).filter(item => item !== null && item !== '').reduce((items, atom) => { if (typeof atom === 'string' && typeof items.at(-1) === 'string') items[items.length - 1] += atom; else items.push(atom); return items; }, []) }))));
}

function managedRange(document, name, requestedTabId) {
  const matches = [];
  for (const tab of documentTabs(document)) {
    for (const named of tab.data.namedRanges?.[name]?.namedRanges ?? []) {
      if ((named.ranges ?? []).length !== 1) throw new GoogleIntegrationError('The managed range is split. Review it before editing.', 'document_conflict');
      matches.push({ tab, namedRangeId: named.namedRangeId, range: { ...named.ranges[0], tabId: tab.id } });
    }
  }
  if (matches.length > 1) throw new GoogleIntegrationError('Duplicate managed ranges need review', 'document_conflict');
  if (matches[0] && requestedTabId && matches[0].tab.id !== requestedTabId) throw new GoogleIntegrationError('The managed entry moved to another tab', 'document_conflict');
  return matches[0] ?? null;
}

/** Copy verification preserves complete native bodies, styles, controls and referenced lists. */
function copySignature(document, { includeTitles = true } = {}) {
  const tabs = documentTabs(document);
  return hash(canonical(tabs.map(tab => {
    const usedLists = new Set();
    const visit = value => { if (!value || typeof value !== 'object') return; if (value.bullet?.listId) usedLists.add(value.bullet.listId); for (const item of Object.values(value)) visit(item); };
    visit(tab.data.body); visit(tab.data.headers); visit(tab.data.footers); visit(tab.data.footnotes);
    const data = { ...tab.data, lists: Object.fromEntries([...usedLists].sort().map(listId => [listId, tab.data.lists?.[listId] ?? { missing: true }])) };
    return { title: includeTitles ? tab.title : null, parentIndex: tab.parent == null ? null : tabs.findIndex(parent => parent.id === tab.parent), data };
  })));
}

/** Native Docs reads remain private and retain tab topology and indexed text. */
export function inspectDocument(document) {
  return { documentId: document.documentId, revisionId: document.revisionId, tabs: documentTabs(document).map(tab => ({ id: tab.id ?? null, title: tab.title, parent: tab.parent, nativeElementCount: atoms(tab.data.body?.content).filter(atom => atom.native).length, tableCount: atoms(tab.data.body?.content).filter(atom => atom.structure?.table).length })), fingerprint: fingerprint(document) };
}

export async function createGoogleAdapter(config, dependencies = {}) {
  if (config.environment !== 'production' || config.integrationsEnabled !== true) throw new GoogleIntegrationError('Google integrations are disabled for this environment', 'integration_disabled');
  if (!config.allowedEmail || !config.dataDir) throw new GoogleIntegrationError('Google owner and private data directory are required', 'configuration_missing');
  const owner = config.allowedEmail.toLowerCase(), root = join(resolve(config.dataDir), 'google');
  if(!dependencies.stateStorage)await mkdir(root, { recursive: true });
  const statePath = join(root, 'connection-state.json');
  let state;
  try { state = dependencies.stateStorage?await dependencies.stateStorage.read():JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new GoogleIntegrationError('Private Google connection state needs repair', 'local_state_failed'); state = { resources: {}, entries: {}, backups: {}, probes: {} }; }
  for (const key of ['resources', 'entries', 'backups', 'probes', 'pending']) state[key] ??= {};
  let stateWrite = Promise.resolve();
  const saveState = () => { stateWrite = stateWrite.then(() => dependencies.stateStorage?dependencies.stateStorage.write(state):jsonFile(statePath, state)); return stateWrite; };
  const protect = dependencies.protect ?? protectSecret, unprotect = dependencies.unprotect ?? unprotectSecret;
  let auth = dependencies.authClient, credentialWrite = Promise.resolve(), credentialFailure = false;
  if (!auth) {
    if (!config.googleClientFile || !config.googleTokenFile) throw new GoogleIntegrationError('Google OAuth connection is not configured', 'authentication_required');
    let client, tokens;
    try { client = await unprotect(config.googleClientFile); tokens = await unprotect(config.googleTokenFile); } catch { throw new GoogleIntegrationError('Google OAuth credentials are unavailable under this Windows identity', 'authentication_required'); }
    const details = client.web ?? client.installed ?? client;
    auth = new OAuth2Client({ clientId: details.client_id ?? details.clientId, clientSecret: details.client_secret ?? details.clientSecret, redirectUri: details.redirect_uri ?? details.redirectUri ?? details.redirect_uris?.[0] });
    auth.setCredentials(tokens.tokens ?? tokens);
  }
  if (config.googleTokenFile) auth.on?.('tokens', tokens => {
    const next = { ...auth.credentials, ...tokens };
    credentialWrite = credentialWrite.then(() => protect(config.googleTokenFile, next)).catch(() => { credentialFailure = true; });
  });
  const request = async (url, options = {}) => {
    await credentialWrite;
    if (credentialFailure) throw new GoogleIntegrationError('Refreshed Google credentials could not be saved securely', 'credential_storage_failed');
    try { return await auth.request({ url, method: 'GET', timeout: 45_000, retry: false, ...options }); }
    catch (error) {
      if (error instanceof GoogleIntegrationError) throw error;
      const status = Number(error.response?.status ?? error.status) || null;
      throw new GoogleIntegrationError(status === 401 ? 'Google authentication needs renewal' : status === 403 ? 'Google permission does not allow this operation' : status === 404 ? 'Google resource not found' : status === 429 ? 'Google temporarily rate-limited this operation' : 'Google operation failed; local records remain saved', status === 401 ? 'authentication_required' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'google_failed', status);
    }
  };
  const get = async (url, params = {}) => (await request(url, { params })).data;
  const identity = await get('https://openidconnect.googleapis.com/v1/userinfo');
  if (identity.email?.toLowerCase() !== owner || identity.email_verified !== true) throw new GoogleIntegrationError('The Google connection belongs to a different or unverified account', 'wrong_account');
  const marker = key => hash(`${owner}|production|${text(key, 1000)}`);
  const props = (key, extra = {}) => ({ lifeos: 'true', lifeosEnvironment: 'production', lifeosOwner: hash(owner), lifeosKey: marker(key), ...extra });
  const metadata = fileId => get(`${DRIVE}/files/${id(fileId)}`, { fields: FILE_FIELDS });
  const verifyPrivate = file => {
    if (file.trashed || !file.owners?.some(person => person.emailAddress?.toLowerCase() === owner) || file.shared !== false || file.permissions?.some(permission => permission.type !== 'user' || permission.emailAddress?.toLowerCase() !== owner)) throw new GoogleIntegrationError('The LifeOS destination is not private to the configured owner', 'destination_not_private');
    return file;
  };
  const verifyManaged = file => {
    verifyPrivate(file);
    if (file.appProperties?.lifeos !== 'true' || file.appProperties?.lifeosEnvironment !== 'production' || file.appProperties?.lifeosOwner !== hash(owner)) throw new GoogleIntegrationError('The destination is not a LifeOS-managed resource', 'destination_not_managed');
    return file;
  };
  const parentCheck = async parentId => { if (parentId) { const file = verifyManaged(await metadata(parentId)); if (file.mimeType !== FOLDER) throw new GoogleIntegrationError('Destination parent is not a folder', 'invalid_input'); } };
  const locks = new Map();
  const locked = async (key, operation) => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release; const current = new Promise(resolve => { release = resolve; }); locks.set(key, current);
    await previous;
    try { return await operation(); } finally { release(); if (locks.get(key) === current) locks.delete(key); }
  };
  async function findManaged(key) {
    if (state.resources[key]) {
      const known = verifyManaged(await metadata(state.resources[key]));
      if (known.appProperties?.lifeosKey !== marker(key)) throw new GoogleIntegrationError('Stored resource identity changed', 'destination_conflict');
      return known;
    }
    const result = await get(`${DRIVE}/files`, { q: `trashed = false and appProperties has { key='lifeosKey' and value=${qString(marker(key))} }`, spaces: 'drive', pageSize: 100, fields: `files(${FILE_FIELDS}),nextPageToken` });
    if (result.nextPageToken || result.files?.length > 1) throw new GoogleIntegrationError('Duplicate LifeOS resources need review', 'duplicate_resource');
    const file = result.files?.[0];
    if (file) { delete state.pending[key]; return remember(key, verifyManaged(file)); }
    if (state.pending[key] && state.pending[key].kind !== 'upload') throw new GoogleIntegrationError('A prior Google create has an uncertain outcome. Retry discovery before another create.', 'creation_uncertain');
    return null;
  }
  async function remember(key, file) { state.resources[key] = file.id; await saveState(); return file; }
  async function createResource(key, operation) {
    state.pending[key] = { kind: 'create', startedAt: new Date().toISOString() }; await saveState();
    try {
      const file = await operation();
      if (!file?.id) throw new GoogleIntegrationError('Google create returned no resource identity', 'creation_uncertain');
      state.resources[key] = file.id; delete state.pending[key]; await saveState(); return file;
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status)) { delete state.pending[key]; await saveState(); }
      throw error;
    }
  }
  async function ensureFolder({ key, name, parentId = null }) {
    return locked(`resource:${key}`, async () => {
      await parentCheck(parentId);
      const existing = await findManaged(key);
      if (existing) { if (existing.mimeType !== FOLDER || parentId && !existing.parents?.includes(parentId)) throw new GoogleIntegrationError('Existing folder does not match its configured location', 'destination_conflict'); return remember(key, existing); }
      const created = await createResource(key, async () => (await request(`${DRIVE}/files`, { method: 'POST', params: { fields: FILE_FIELDS }, data: { name: text(name, 200), mimeType: FOLDER, appProperties: props(key), ...(parentId ? { parents: [parentId] } : {}) } })).data);
      return remember(key, verifyManaged(await metadata(created.id)));
    });
  }
  async function readBinary(fileId) { const result = await request(`${DRIVE}/files/${id(fileId)}`, { params: { alt: 'media' }, responseType: 'arraybuffer' }); return Buffer.from(result.data); }
  async function readManagedFile(fileId) {
    const file = verifyManaged(await metadata(fileId));
    if (file.mimeType?.startsWith('application/vnd.google-apps.')) throw new GoogleIntegrationError('A managed binary file is required for backup restore', 'invalid_input');
    const size = Number(file.size); if (!Number.isSafeInteger(size) || size < 0 || size > 256 * 1024 * 1024) throw new GoogleIntegrationError('Managed file size is unavailable or exceeds the bounded restore limit', 'file_too_large');
    const bytes = await readBinary(fileId);
    if (bytes.length !== size || file.md5Checksum && createHash('md5').update(bytes).digest('hex') !== file.md5Checksum) throw new GoogleIntegrationError('Managed file read-back does not match its metadata', 'verification_failed');
    return { file, bytes, sha256: hash(bytes), verified: true };
  }
  async function uploadFile({ key, name, content, mimeType = 'application/octet-stream', parentId, probe = false }) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (bytes.length > 256 * 1024 * 1024) throw new GoogleIntegrationError('This file needs the large-file backup path', 'file_too_large');
    text(mimeType, 200); const digest = hash(bytes);
    return locked(`resource:${key}`, async () => {
      await parentCheck(parentId);
      let file = await findManaged(key);
      if (file) {
        if (file.mimeType !== mimeType || file.appProperties?.lifeosSHA256 !== digest || parentId && !file.parents?.includes(parentId)) throw new GoogleIntegrationError('An immutable archive key already has different content or location', 'archive_conflict');
      } else {
        const metadataBody = { name: text(name, 250), mimeType, appProperties: props(key, { lifeosSHA256: digest, ...(probe ? { lifeosProbe: 'true' } : {}) }), ...(parentId ? { parents: [parentId] } : {}) };
        const uploadDirectory = join(root, 'upload-sessions'); await mkdir(uploadDirectory, { recursive: true });
        const sessionFile = join(uploadDirectory, `${marker(key)}.dpapi`);
        let sessionValue = null, offset = 0;
        if (state.pending[key]?.kind === 'upload') {
          try { sessionValue = await unprotect(sessionFile); } catch { throw new GoogleIntegrationError('Interrupted upload session cannot be restored securely', 'upload_failed'); }
          if (sessionValue.sha256 !== digest) throw new GoogleIntegrationError('Interrupted upload key belongs to different content', 'archive_conflict');
        } else {
          const initial = await request('https://www.googleapis.com/upload/drive/v3/files', { method: 'POST', params: { uploadType: 'resumable', fields: FILE_FIELDS }, headers: { 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(bytes.length), 'Content-Type': 'application/json; charset=UTF-8' }, data: metadataBody });
          sessionValue = { url: initial.headers?.get?.('location') ?? initial.headers?.location, sha256: digest, createdAt: new Date().toISOString() };
          await protect(sessionFile, sessionValue);
          state.pending[key] = { kind: 'upload', startedAt: sessionValue.createdAt }; await saveState();
        }
        let session; try { session = new URL(sessionValue.url); } catch { throw new GoogleIntegrationError('Google upload did not return a valid session', 'upload_failed'); }
        if (session.origin !== 'https://www.googleapis.com' || !session.pathname.startsWith('/upload/drive/v3/files')) throw new GoogleIntegrationError('Upload session destination rejected', 'upload_failed');
        const status = await request(session.href, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${bytes.length}` }, data: Buffer.alloc(0), validateStatus: status => [200, 201, 308].includes(status) });
        if ([200, 201].includes(status.status) && status.data?.id) file = status.data;
        else {
          const range = status.headers?.get?.('range') ?? status.headers?.range;
          if (range) { const match = /^bytes=0-(\d+)$/.exec(range); if (!match) throw new GoogleIntegrationError('Google upload returned an invalid progress range', 'upload_failed'); offset = Number(match[1]) + 1; }
          if (offset > bytes.length) throw new GoogleIntegrationError('Upload progress exceeds the local file', 'upload_failed');
          const final = await request(session.href, { method: 'PUT', headers: { 'Content-Type': mimeType, 'Content-Length': String(bytes.length - offset), ...(bytes.length ? { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) }, data: bytes.subarray(offset) });
          file = final.data;
        }
        if (!file?.id) throw new GoogleIntegrationError('Google upload did not return a stored resource', 'upload_failed');
        state.resources[key] = file.id; delete state.pending[key]; await saveState();
      }
      file = verifyManaged(await metadata(file.id));
      if (hash(await readBinary(file.id)) !== digest) throw new GoogleIntegrationError('Drive archive read-back did not match the local file', 'verification_failed');
      await remember(key, file);
      return { file, sha256: digest, verified: true, bytes: bytes.length };
    });
  }
  async function trustedReadDocument(documentId) {
    const document = await get(`${DOCS}/${id(documentId)}`, { includeTabsContent: true,...(dependencies.documentFields?{fields:dependencies.documentFields}:{}) });
    if (document.documentId !== documentId || !document.revisionId || !documentTabs(document).length) throw new GoogleIntegrationError('Google document read was incomplete', 'verification_failed');
    if(dependencies.trustedReadStorage){const inspection=inspectDocument(document),path=await dependencies.trustedReadStorage.write(document,inspection);return {document,inspection,path};}
    const directory = join(root, 'trusted-reads', hash(documentId)); await mkdir(directory, { recursive: true });
    const path = join(directory, `${hash(document.revisionId)}.json`);
    await jsonFile(path, document);
    const inspection = inspectDocument(document);
    await jsonFile(join(directory, `${hash(document.revisionId)}.inventory.json`), inspection);
    return { document, inspection, path };
  }
  async function createPrivateDocument({ key, name, parentId, probe = false }) {
    return locked(`resource:${key}`, async () => {
      await parentCheck(parentId); let file = await findManaged(key);
      if (!file) file = await createResource(key, async () => (await request(`${DRIVE}/files`, { method: 'POST', params: { fields: FILE_FIELDS }, data: { name: text(name, 250), mimeType: DOCUMENT, appProperties: props(key, probe ? { lifeosProbe: 'true' } : {}), ...(parentId ? { parents: [parentId] } : {}) } })).data);
      file = verifyManaged(await metadata(file.id));
      if (file.mimeType !== DOCUMENT) throw new GoogleIntegrationError('Expected a native Google document', 'destination_conflict');
      await trustedReadDocument(file.id); return remember(key, file);
    });
  }
  async function copyDocument({ documentId, key, name, parentId, probe = false }) {
    return locked(`resource:${key}`, async () => {
      await parentCheck(parentId);
      const before = await trustedReadDocument(documentId);
      let file = await findManaged(key);
      if (!file) file = await createResource(key, async () => (await request(`${DRIVE}/files/${id(documentId)}/copy`, { method: 'POST', params: { fields: FILE_FIELDS }, data: { name: text(name, 250), appProperties: props(key, { lifeosSource: hash(documentId), ...(probe ? { lifeosProbe: 'true' } : {}) }), ...(parentId ? { parents: [parentId] } : {}) } })).data);
      file = verifyManaged(await metadata(file.id));
      let after = await trustedReadDocument(file.id);
      if (copySignature(before.document, { includeTitles: false }) !== copySignature(after.document, { includeTitles: false })) throw new GoogleIntegrationError('The native document copy did not match the current source content and used native structures', 'verification_failed');
      const sourceTabs = documentTabs(before.document), copiedTabs = documentTabs(after.document);
      const titleRepairs = sourceTabs.flatMap((tab, index) => tab.title === copiedTabs[index].title ? [] : [{ updateDocumentTabProperties: { tabProperties: { tabId: copiedTabs[index].id, title: tab.title }, fields: 'title' } }]);
      // Drive sometimes resets a copied tab name to "Tab 1". Restore only that metadata.
      if (titleRepairs.length) {
        if (titleRepairs.some(item => !item.updateDocumentTabProperties.tabProperties.tabId)) throw new GoogleIntegrationError('Copied tab identity is unavailable for title preservation', 'verification_failed');
        await request(`${DOCS}/${id(file.id)}:batchUpdate`, { method: 'POST', data: { requests: titleRepairs, writeControl: { requiredRevisionId: after.document.revisionId } } });
        after = await trustedReadDocument(file.id);
      }
      if (copySignature(before.document) !== copySignature(after.document)) throw new GoogleIntegrationError('The native document copy did not preserve tab titles and content', 'verification_failed');
      await remember(key, file); return { file, sourceRevisionId: before.document.revisionId, verified: true, fingerprint: after.inspection.fingerprint,copyRevisionId:after.document.revisionId };
    });
  }
  async function backupDocument({ documentId, parentId }) {
    const snapshot = await trustedReadDocument(documentId);
    const key = `document-backup:${documentId}:${snapshot.document.revisionId}`;
    if (state.backups[documentId]) {
      const old = state.backups[documentId]; verifyManaged(await metadata(old.fileId));
      if(dependencies.verifyExistingBackup){const refreshed=await dependencies.verifyExistingBackup(old);if(refreshed){Object.assign(old,refreshed);await saveState();}return old;}
      if (old.fingerprint && (await trustedReadDocument(old.fileId)).inspection.fingerprint !== old.fingerprint) throw new GoogleIntegrationError('The original document backup changed and needs review', 'backup_conflict');
      return old;
    }
    const copy = await copyDocument({ documentId, key, name: 'LifeOS original document backup', parentId });
    const result = { fileId: copy.file.id, sourceRevisionId: copy.sourceRevisionId, verified: true, verifiedAt: new Date().toISOString(), localSnapshot: snapshot.path, fingerprint: copy.fingerprint,verifiedDocumentRevision:copy.copyRevisionId, ...(dependencies.captureBackupVersion ? await dependencies.captureBackupVersion(copy.file.id) : {}) };
    state.backups[documentId] = result; await saveState(); return result;
  }
  const calendarIds = Object.values(config.calendarIds ?? {}).filter(Boolean);
  const personalId = config.calendarIds?.personal ?? config.calendarIds?.personalRw ?? config.calendarIds?.PERSONAL_RW;
  async function readCalendar(calendarId, { timeMin, timeMax }) {
    if (!calendarIds.includes(calendarId)) throw new GoogleIntegrationError('This calendar is not selected for LifeOS', 'calendar_denied');
    if (!Number.isFinite(Date.parse(timeMin)) || !Number.isFinite(Date.parse(timeMax)) || Date.parse(timeMax) <= Date.parse(timeMin)) throw new GoogleIntegrationError('A valid bounded calendar window is required', 'invalid_input');
    const calendar = await get(`${CALENDAR}/users/me/calendarList/${id(calendarId)}`);
    const events = []; let pageToken;
    do {
      const page = await get(`${CALENDAR}/calendars/${id(calendarId)}/events`, { timeMin, timeMax, singleEvents: true, showDeleted: true, maxResults: 2500, orderBy: 'startTime', ...(pageToken ? { pageToken } : {}) });
      events.push(...(page.items ?? []).map(event => ({ ...event, calendarId })));
      pageToken = page.nextPageToken;
      if (events.length > 25_000) throw new GoogleIntegrationError('Calendar window is too large for a complete read', 'window_too_large');
    } while (pageToken);
    return { calendarId, summary: calendar.summary, accessRole: calendar.accessRole, timeZone: calendar.timeZone, events, complete: true, fetchedAt: new Date().toISOString() };
  }
  async function writePersonalEvent({ key, event, calendarId = personalId, probe = false }) {
    assertPersonalCalendarWrite({ calendarId, personalCalendarId: personalId, attendees: event?.attendees ?? [] });
    for (const field of Object.keys(event ?? {})) if (!['summary', 'description', 'location', 'start', 'end', 'transparency', 'attendees'].includes(field)) throw new GoogleIntegrationError('Calendar event contains an unsupported field', 'invalid_input');
    const eventId = hash(`lifeos-event:${marker(key)}`);
    const desired = { summary: text(event.summary, 300), description: event.description == null || event.description === '' ? '' : text(event.description, 10000), location: event.location == null || event.location === '' ? '' : text(event.location, 1000), start: event.start, end: event.end, transparency: event.transparency ?? 'opaque', visibility: 'private', reminders: { useDefault: false, overrides: [] }, extendedProperties: { private: props(`calendar:${key}`) } };
    if (!['opaque', 'transparent'].includes(desired.transparency)) throw new GoogleIntegrationError('Unsupported calendar availability value', 'invalid_input');
    const eventInstant = value => value?.dateTime ? Date.parse(value.dateTime) : value?.date && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? Date.parse(`${value.date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(eventInstant(event.start)) || !Number.isFinite(eventInstant(event.end)) || eventInstant(event.end) <= eventInstant(event.start) || Boolean(event.start.date) !== Boolean(event.end.date)) throw new GoogleIntegrationError('Valid matching calendar event times are required', 'invalid_input');
    const eventDigest = value => hash(canonical({ summary: value.summary, description: value.description ?? '', location: value.location ?? '', start: eventInstant(value.start), end: eventInstant(value.end), allDay: Boolean(value.start?.date), transparency: value.transparency ?? 'opaque', visibility: value.visibility, reminders: { useDefault: value.reminders?.useDefault, overrides: value.reminders?.overrides ?? [] } }));
    desired.extendedProperties.private.lifeosContentHash = eventDigest(desired);
    if (probe) desired.extendedProperties.private.lifeosProbe = 'true';
    let old = null;
    try { old = await get(`${CALENDAR}/calendars/${id(calendarId)}/events/${id(eventId)}`); } catch (error) { if (error.status !== 404) throw error; }
    if (old && (old.status === 'cancelled' || old.attendees?.length || old.extendedProperties?.private?.lifeosKey !== marker(`calendar:${key}`))) throw new GoogleIntegrationError('The existing calendar event needs an intentional review', 'calendar_conflict');
    if (old && old.extendedProperties.private.lifeosContentHash !== eventDigest(old)) throw new GoogleIntegrationError('This LifeOS calendar event changed outside the app and needs review', 'calendar_conflict');
    if (old && eventDigest(old) === eventDigest(desired)) return { event: old, verified: true, created: false, duplicate: true, providerId: old.id };
    const result = (await request(`${CALENDAR}/calendars/${id(calendarId)}/events${old ? `/${id(eventId)}` : ''}`, { method: old ? 'PATCH' : 'POST', params: { sendUpdates: 'none' }, ...(old?.etag ? { headers: { 'If-Match': old.etag } } : {}), data: { ...desired, ...(!old ? { id: eventId } : {}) } })).data;
    const readback = await get(`${CALENDAR}/calendars/${id(calendarId)}/events/${id(eventId)}`);
    if (readback.summary !== desired.summary || (readback.description ?? '') !== desired.description || (readback.location ?? '') !== desired.location || eventInstant(readback.start) !== eventInstant(desired.start) || eventInstant(readback.end) !== eventInstant(desired.end) || readback.visibility !== 'private' || readback.reminders?.useDefault !== false || readback.reminders?.overrides?.length || readback.extendedProperties?.private?.lifeosKey !== desired.extendedProperties.private.lifeosKey || readback.attendees?.length) throw new GoogleIntegrationError('Personal calendar read-back did not match', 'verification_failed');
    return { event: readback, verified: true, created: !old, providerId: result.id };
  }
  async function cleanupProbeEvent({ key, calendarId = personalId }) {
    assertPersonalCalendarWrite({ calendarId, personalCalendarId: personalId });
    const eventId = hash(`lifeos-event:${marker(key)}`), url = `${CALENDAR}/calendars/${id(calendarId)}/events/${id(eventId)}`;
    let event;
    try { event = await get(url); } catch (error) { if ([404, 410].includes(error.status)) return { removed: true, alreadyAbsent: true }; throw error; }
    if (event.extendedProperties?.private?.lifeosProbe !== 'true' || event.extendedProperties?.private?.lifeosKey !== marker(`calendar:${key}`) || event.attendees?.length) throw new GoogleIntegrationError('Only a synthetic LifeOS event may be cleaned up by this method', 'cleanup_denied');
    if (event.status !== 'cancelled') await request(url, { method: 'DELETE', params: { sendUpdates: 'none' }, ...(event.etag ? { headers: { 'If-Match': event.etag } } : {}) });
    try { if ((await get(url)).status !== 'cancelled') throw new GoogleIntegrationError('Synthetic calendar cleanup did not verify', 'verification_failed'); } catch (error) { if (![404, 410].includes(error.status)) throw error; }
    return { removed: true, eventId };
  }
  async function cleanupProbeFile(fileId) {
    const file = verifyManaged(await metadata(fileId));
    if (file.appProperties?.lifeosProbe !== 'true' || !Object.values(state.resources).includes(fileId)) throw new GoogleIntegrationError('Only synthetic files created by this adapter can be cleaned up', 'cleanup_denied');
    await request(`${DRIVE}/files/${id(fileId)}`, { method: 'PATCH', data: { trashed: true }, params: { fields: 'id,trashed' } });
    if (!(await metadata(fileId)).trashed) throw new GoogleIntegrationError('Synthetic cleanup could not be verified', 'verification_failed');
    return { trashed: true, fileId };
  }
  async function readSource(kind) {
    const fileId = sourceId(config.sourceIds?.[kind]);
    if (!fileId) throw new GoogleIntegrationError('The requested source is not configured', 'source_missing');
    const file = await metadata(fileId);
    if (file.mimeType === DOCUMENT) return { file, ...(await trustedReadDocument(fileId)) };
    return { file, bytes: await readBinary(fileId) };
  }
  return { identity: { email: owner, verified: true }, readSource, readManagedFile, readCalendar, readSelectedCalendars: window => Promise.all(calendarIds.map(calendarId => readCalendar(calendarId, window))), ensureFolder, findManaged, uploadFile, uploadText: options => uploadFile({ ...options, content: Buffer.from(options.text, 'utf8'), mimeType: 'text/plain' }), createPrivateDocument, trustedReadDocument, backupDocument, copyDocument, writePersonalEvent, cleanupProbeEvent, cleanupProbeFile, flushCredentials: async () => { await credentialWrite; if (credentialFailure) throw new GoogleIntegrationError('Google credential persistence failed', 'credential_storage_failed'); } };
}
