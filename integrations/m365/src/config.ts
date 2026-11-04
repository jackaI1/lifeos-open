import {resolve} from 'node:path';

export interface M365Config {
  clientId: string;
  tenantId: string;
  siteUrl: string;
  listName: string;
  lifeosDatabase: string;
  cachePath: string;
  /** Overrides the workspace's own time zone setting when set. */
  timeZone?: string;
}

/** Reads configuration from environment variables. None of these values are secrets, but none are committed either. */
export function loadConfig(env: Record<string, string | undefined> = process.env, require: Array<'clientId' | 'siteUrl'> = []): M365Config {
  const config: M365Config = {
    clientId: env.M365_CLIENT_ID?.trim() ?? '',
    tenantId: env.M365_TENANT_ID?.trim() || 'organizations',
    siteUrl: env.M365_SITE_URL?.trim() ?? '',
    listName: env.M365_LIST_NAME?.trim() || 'LifeOS Tasks',
    lifeosDatabase: resolve(env.LIFEOS_DATABASE ?? '.local/workspace.sqlite'),
    cachePath: resolve(env.M365_TOKEN_CACHE ?? '.local/m365-token-cache.json'),
    timeZone: env.M365_TIME_ZONE?.trim() || undefined,
  };
  const names = {clientId: 'M365_CLIENT_ID', siteUrl: 'M365_SITE_URL'};
  const missing = require.filter((key) => !config[key]).map((key) => names[key]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. See integrations/m365/README.md.`);
  return config;
}
