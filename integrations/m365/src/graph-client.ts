import type {
  GraphCollection,
  GraphColumnDefinition,
  GraphErrorBody,
  GraphFields,
  GraphList,
  GraphListItem,
  GraphSite,
  GraphUser,
} from './graph-types.ts';

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/** Supplies a bearer token. `forceRefresh` is set after Graph rejects the previous token. */
export type TokenProvider = (options?: { forceRefresh?: boolean }) => Promise<string>;

export interface GraphClientOptions {
  getToken: TokenProvider;
  baseUrl?: string;
  /** Retries after the first attempt. Default 4 (five attempts in total). */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetch?: typeof fetch;
  /** Injected so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1). Injected for deterministic jitter. */
  random?: () => number;
  /** Called before each retry, for progress logs. */
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  reason: string;
  method: string;
  path: string;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class GraphError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly attempts: number;
  constructor(message: string, details: { status: number; code: string; requestId?: string; attempts: number }) {
    super(message);
    this.name = 'GraphError';
    this.status = details.status;
    this.code = details.code;
    this.requestId = details.requestId;
    this.attempts = details.attempts;
  }
}

const RETRY_ANY_METHOD = new Set([429, 503]);
const RETRY_IDEMPOTENT_ONLY = new Set([502, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);

/** Parses a Retry-After header: delta-seconds or an HTTP date. Returns null when absent or invalid. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export class GraphClient {
  readonly baseUrl: string;
  private readonly options: Required<Omit<GraphClientOptions, 'onRetry' | 'baseUrl'>> & Pick<GraphClientOptions, 'onRetry'>;

  constructor(options: GraphClientOptions) {
    this.baseUrl = (options.baseUrl ?? GRAPH_BASE_URL).replace(/\/+$/, '');
    this.options = {
      getToken: options.getToken,
      maxRetries: options.maxRetries ?? 4,
      baseDelayMs: options.baseDelayMs ?? 500,
      maxDelayMs: options.maxDelayMs ?? 30_000,
      fetch: options.fetch ?? globalThis.fetch,
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      random: options.random ?? Math.random,
      onRetry: options.onRetry,
    };
  }

  /** Full-jitter exponential backoff, or the server's Retry-After when it is larger. */
  private delayFor(attempt: number, retryAfterMs: number | null): number {
    const { baseDelayMs, maxDelayMs, random } = this.options;
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jittered = Math.floor(random() * exponential);
    return Math.min(maxDelayMs, Math.max(jittered, retryAfterMs ?? 0));
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path.startsWith('https://') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);
    // The bearer token must never be sent anywhere except the configured Graph origin.
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error(`Refusing to send Graph credentials to ${url.origin}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    return url.toString();
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const target = this.url(path, options.query);
    const verb = method.toUpperCase();
    let forceRefresh = false;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.options.getToken(forceRefresh ? { forceRefresh: true } : undefined);
      forceRefresh = false;
      let response: Response;
      try {
        response = await this.options.fetch(target, {
          method: verb,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...options.headers,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (cause) {
        // Connection resets and DNS failures: safe to repeat only when the call is idempotent.
        if (IDEMPOTENT.has(verb) && attempt < this.options.maxRetries) {
          await this.backoff(attempt, null, `network error: ${(cause as Error).message}`, verb, path);
          continue;
        }
        throw new GraphError(`Network error calling Graph: ${(cause as Error).message}`, { status: 0, code: 'networkError', attempts: attempt + 1 });
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        attempt--; // A token refresh does not consume a retry.
        continue;
      }

      const retryable = RETRY_ANY_METHOD.has(response.status) || (RETRY_IDEMPOTENT_ONLY.has(response.status) && IDEMPOTENT.has(verb));
      if (retryable && attempt < this.options.maxRetries) {
        await response.body?.cancel();
        await this.backoff(attempt, parseRetryAfter(response.headers.get('retry-after')), `HTTP ${response.status}`, verb, path);
        continue;
      }
      throw await this.toError(response, attempt + 1);
    }
  }

  private async backoff(attempt: number, retryAfterMs: number | null, reason: string, method: string, path: string): Promise<void> {
    const delayMs = this.delayFor(attempt, retryAfterMs);
    this.options.onRetry?.({ attempt: attempt + 1, delayMs, reason, method, path });
    await this.options.sleep(delayMs);
  }

  private async toError(response: Response, attempts: number): Promise<GraphError> {
    let body: GraphErrorBody = {};
    try {
      body = (await response.json()) as GraphErrorBody;
    } catch {
      // Non-JSON error bodies (gateway pages) carry nothing worth surfacing.
    }
    const code = body.error?.code ?? `http${response.status}`;
    const requestId = body.error?.innerError?.['request-id'] ?? response.headers.get('request-id') ?? undefined;
    const message = body.error?.message ?? response.statusText;
    return new GraphError(`Graph ${response.status} ${code}: ${message}`, { status: response.status, code, requestId, attempts });
  }

  /** Follows `@odata.nextLink` until the collection is exhausted. */
  async getAll<T>(path: string, query?: RequestOptions['query'], headers?: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = this.url(path, query);
    for (let page = 0; next; page++) {
      if (page >= 1000) throw new Error('Graph paging did not terminate after 1000 pages');
      const result: GraphCollection<T> = await this.request<GraphCollection<T>>('GET', next, { headers });
      items.push(...result.value);
      next = result['@odata.nextLink'];
    }
    return items;
  }

  // ---- Typed endpoints -------------------------------------------------------------------

  me(): Promise<GraphUser> {
    return this.request('GET', '/me', { query: { $select: 'id,displayName,userPrincipalName' } });
  }

  /** Resolves a site from its host and server-relative path, e.g. ('contoso.sharepoint.com', '/sites/LifeOS'). */
  getSiteByPath(hostname: string, serverRelativePath: string): Promise<GraphSite> {
    const path = serverRelativePath.startsWith('/') ? serverRelativePath : `/${serverRelativePath}`;
    return this.request('GET', `/sites/${hostname}:${path}`, { query: { $select: 'id,displayName,webUrl' } });
  }

  getLists(siteId: string): Promise<GraphList[]> {
    return this.getAll(`/sites/${siteId}/lists`, { $select: 'id,name,displayName,webUrl,list' });
  }

  createList(siteId: string, displayName: string, columns: GraphColumnDefinition[]): Promise<GraphList> {
    return this.request('POST', `/sites/${siteId}/lists`, {
      body: { displayName, columns, list: { template: 'genericList' } },
    });
  }

  getListColumns(siteId: string, listId: string): Promise<GraphColumnDefinition[]> {
    return this.getAll(`/sites/${siteId}/lists/${listId}/columns`);
  }

  addListColumn(siteId: string, listId: string, column: GraphColumnDefinition): Promise<GraphColumnDefinition> {
    return this.request('POST', `/sites/${siteId}/lists/${listId}/columns`, { body: column });
  }

  getListItems(siteId: string, listId: string, select: string[]): Promise<GraphListItem[]> {
    return this.getAll(`/sites/${siteId}/lists/${listId}/items`, {
      $expand: `fields($select=${select.join(',')})`,
      $top: 200,
    });
  }

  createListItem(siteId: string, listId: string, fields: GraphFields): Promise<GraphListItem> {
    return this.request('POST', `/sites/${siteId}/lists/${listId}/items`, { body: { fields } });
  }

  updateListItemFields(siteId: string, listId: string, itemId: string, fields: GraphFields): Promise<GraphFields> {
    return this.request('PATCH', `/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, { body: fields });
  }

  deleteListItem(siteId: string, listId: string, itemId: string): Promise<void> {
    return this.request('DELETE', `/sites/${siteId}/lists/${listId}/items/${itemId}`);
  }
}
