import type {GraphClient} from './graph-client.ts';
import type {GraphFields, GraphList, GraphListItem} from './graph-types.ts';
import type {LifeosTask} from './lifeos-source.ts';
import {COLUMN, LIST_COLUMNS, MANAGED_FIELDS, toDesiredItem, type DesiredItem} from './mapping.ts';

export interface SyncOptions {
  listName: string;
  /** Compute and report the plan without writing anything to Microsoft 365. */
  dryRun?: boolean;
  /** Delete list items whose LifeOS task no longer exists. Off by default. */
  prune?: boolean;
  /** Rewrite every item even when its hash matches (repairs manual edits in SharePoint). */
  force?: boolean;
  timeZone: string;
  log?: (message: string) => void;
}

export interface SyncResult {
  site: string;
  list: string;
  listCreated: boolean;
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  /** Remote items whose LifeOS task is gone (kept unless `prune`). */
  orphaned: number;
  pruned: number;
  columnsAdded: string[];
}

/** Resolves `https://tenant.sharepoint.com/sites/Name` (or the tenant root site) to a Graph site id. */
export async function resolveSite(client: GraphClient, siteUrl: string): Promise<{id: string; webUrl: string}> {
  const url = new URL(siteUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.sharepoint.com') && !url.hostname.endsWith('.sharepoint.us')) {
    throw new Error('M365_SITE_URL must be an https SharePoint Online site URL such as https://contoso.sharepoint.com/sites/LifeOS');
  }
  const path = url.pathname.replace(/\/+$/, '');
  const site = path ? await client.getSiteByPath(url.hostname, path) : await client.request<{id: string; webUrl?: string}>('GET', '/sites/root');
  return {id: site.id, webUrl: site.webUrl ?? siteUrl};
}

async function ensureList(client: GraphClient, siteId: string, options: SyncOptions): Promise<{list: GraphList | null; created: boolean; columnsAdded: string[]}> {
  const lists = await client.getLists(siteId);
  const existing = lists.find((list) => list.displayName === options.listName);
  if (!existing) {
    if (options.dryRun) return {list: null, created: true, columnsAdded: LIST_COLUMNS.map((c) => c.name)};
    const list = await client.createList(siteId, options.listName, LIST_COLUMNS);
    return {list, created: true, columnsAdded: LIST_COLUMNS.map((c) => c.name)};
  }
  // Add any managed column that an older sync, or a user, left out.
  const present = new Set((await client.getListColumns(siteId, existing.id)).map((c) => c.name));
  const missing = LIST_COLUMNS.filter((c) => !present.has(c.name));
  if (!options.dryRun) for (const column of missing) await client.addListColumn(siteId, existing.id, column);
  return {list: existing, created: false, columnsAdded: missing.map((c) => c.name)};
}

const sameValue = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

/** Field values for an update: the desired fields plus the hash that marks them as synced. */
const withHash = (item: DesiredItem): GraphFields => ({...item.fields, [COLUMN.hash]: item.hash});

export async function syncTasks(client: GraphClient, site: {id: string; webUrl: string}, tasks: LifeosTask[], options: SyncOptions): Promise<SyncResult> {
  const log = options.log ?? (() => {});
  const result: SyncResult = {
    site: site.webUrl,
    list: options.listName,
    listCreated: false,
    dryRun: options.dryRun === true,
    created: 0,
    updated: 0,
    unchanged: 0,
    orphaned: 0,
    pruned: 0,
    columnsAdded: [],
  };
  const {list, created, columnsAdded} = await ensureList(client, site.id, options);
  result.listCreated = created;
  result.columnsAdded = created ? [] : columnsAdded;

  const remote = new Map<string, GraphListItem>();
  if (list) {
    for (const item of await client.getListItems(site.id, list.id, MANAGED_FIELDS)) {
      const key = item.fields?.[COLUMN.id];
      // First item wins if a duplicate ever appears; extras are left alone rather than guessed at.
      if (typeof key === 'string' && key && !remote.has(key)) remote.set(key, item);
    }
  }

  const desired = tasks.map((task) => toDesiredItem(task, options.timeZone));
  const seen = new Set<string>();
  for (const item of desired) {
    if (seen.has(item.lifeosId)) continue;
    seen.add(item.lifeosId);
    const current = remote.get(item.lifeosId);
    if (!current) {
      result.created++;
      log(`${options.dryRun ? 'would create' : 'create'}  ${item.fields.Title}`);
      if (!options.dryRun && list) await client.createListItem(site.id, list.id, withHash(item));
      continue;
    }
    const upToDate = sameValue(current.fields?.[COLUMN.hash], item.hash);
    if (upToDate && !options.force) {
      result.unchanged++;
      continue;
    }
    const next = withHash(item);
    // Send only columns that differ, so unrelated edits made in SharePoint are not rewritten needlessly.
    const changed = options.force ? next : Object.fromEntries(Object.entries(next).filter(([key, value]) => !sameValue(current.fields?.[key], value)));
    if (Object.keys(changed).length === 0) {
      result.unchanged++;
      continue;
    }
    result.updated++;
    log(`${options.dryRun ? 'would update' : 'update'}  ${item.fields.Title}`);
    if (!options.dryRun && list) await client.updateListItemFields(site.id, list.id, current.id, changed);
  }

  for (const [lifeosId, item] of remote) {
    if (seen.has(lifeosId)) continue;
    result.orphaned++;
    if (!options.prune) continue;
    result.pruned++;
    log(`${options.dryRun ? 'would delete' : 'delete'}  ${item.fields?.Title ?? lifeosId}`);
    if (!options.dryRun && list) await client.deleteListItem(site.id, list.id, item.id);
  }
  return result;
}
