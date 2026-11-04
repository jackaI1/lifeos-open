import {chmod, mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {TokenProvider} from './graph-client.ts';

/** Delegated Microsoft Graph permissions. See integrations/m365/README.md for why each is needed. */
export const GRAPH_SCOPES = ['Sites.ReadWrite.All', 'User.Read'];

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresInSeconds: number;
}

export interface AuthConfig {
  clientId: string;
  /** Tenant id, a verified domain, or `organizations`. Personal accounts cannot use SharePoint. */
  tenantId: string;
  cachePath: string;
  scopes?: string[];
}

/** The slice of MSAL's PublicClientApplication that this module uses (and tests replace). */
export interface MsalApp {
  getTokenCache(): {getAllAccounts(): Promise<MsalAccount[]>};
  acquireTokenSilent(request: {account: MsalAccount; scopes: string[]; forceRefresh?: boolean}): Promise<{accessToken: string; account?: MsalAccount | null} | null>;
  acquireTokenByDeviceCode(request: {
    scopes: string[];
    deviceCodeCallback: (response: {userCode: string; verificationUri: string; message: string; expiresIn: number}) => void;
  }): Promise<{accessToken: string; account?: MsalAccount | null} | null>;
}
export interface MsalAccount {
  homeAccountId: string;
  username: string;
  tenantId?: string;
}

/** Persists MSAL's serialized token cache with owner-only permissions, outside version control. */
export function fileCachePlugin(path: string) {
  return {
    async beforeCacheAccess(context: {tokenCache: {deserialize(data: string): void}}) {
      try {
        context.tokenCache.deserialize(await readFile(path, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
    async afterCacheAccess(context: {cacheHasChanged: boolean; tokenCache: {serialize(): string}}) {
      if (!context.cacheHasChanged) return;
      await mkdir(dirname(path), {recursive: true, mode: 0o700});
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, context.tokenCache.serialize(), {mode: 0o600});
      await chmod(temporary, 0o600);
      await rename(temporary, path);
    },
  };
}

export async function createMsalApp(config: AuthConfig): Promise<MsalApp> {
  const {PublicClientApplication} = await import('@azure/msal-node');
  return new PublicClientApplication({
    auth: {clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`},
    cache: {cachePlugin: fileCachePlugin(config.cachePath)},
  }) as unknown as MsalApp;
}

/** Interactive sign-in with the OAuth device-code flow. Stores the refresh token in the cache file. */
export async function loginWithDeviceCode(app: MsalApp, scopes: string[], show: (prompt: DeviceCodePrompt) => void): Promise<MsalAccount> {
  const result = await app.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (response) =>
      show({userCode: response.userCode, verificationUri: response.verificationUri, message: response.message, expiresInSeconds: response.expiresIn}),
  });
  if (!result?.account) throw new Error('Device-code sign-in finished without an account.');
  return result.account;
}

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to Microsoft 365. Run `npm run m365 -- login` first.');
    this.name = 'NotSignedInError';
  }
}

/** A Graph token provider that renews silently from the cached refresh token. */
export function silentTokenProvider(app: MsalApp, scopes: string[] = GRAPH_SCOPES): TokenProvider {
  return async (options) => {
    const accounts = await app.getTokenCache().getAllAccounts();
    if (accounts.length === 0) throw new NotSignedInError();
    const result = await app.acquireTokenSilent({account: accounts[0], scopes, forceRefresh: options?.forceRefresh === true});
    if (!result?.accessToken) throw new NotSignedInError();
    return result.accessToken;
  };
}

export async function signOut(cachePath: string): Promise<void> {
  await rm(cachePath, {force: true});
}
