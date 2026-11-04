import {GraphClient} from '../src/graph-client.ts';
import type {GraphColumnDefinition, GraphFields} from '../src/graph-types.ts';

interface FakeList {
  id: string;
  displayName: string;
  columns: GraphColumnDefinition[];
  items: Map<string, GraphFields>;
}

/** An in-memory stand-in for the Graph SharePoint endpoints this integration uses. */
export class FakeGraph {
  lists = new Map<string, FakeList>();
  requests: string[] = [];
  private nextId = 1;

  readonly siteId = 'contoso.sharepoint.com,site-guid,web-guid';

  get writes(): string[] {
    return this.requests.filter((r) => !r.startsWith('GET '));
  }

  client(extra: {failFirst?: number} = {}): GraphClient {
    let failures = extra.failFirst ?? 0;
    return new GraphClient({
      getToken: async () => 'test-token',
      sleep: async () => {},
      fetch: (async (url: string, init: RequestInit) => {
        if (failures > 0) {
          failures--;
          return new Response('{}', {status: 429, headers: {'retry-after': '0'}});
        }
        return this.handle(new URL(url), String(init.method), init.body ? JSON.parse(String(init.body)) : undefined);
      }) as typeof fetch,
    });
  }

  private reply(status: number, body?: unknown): Response {
    return body === undefined ? new Response(null, {status}) : new Response(JSON.stringify(body), {status});
  }

  private handle(url: URL, method: string, body: any): Response {
    this.requests.push(`${method} ${url.pathname}`);
    const path = url.pathname.replace('/v1.0', '');
    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/sites\/([^/]+)\/lists$/))) {
      if (method === 'GET') return this.reply(200, {value: [...this.lists.values()].map((l) => ({id: l.id, displayName: l.displayName}))});
      const id = `list-${this.nextId++}`;
      this.lists.set(id, {id, displayName: body.displayName, columns: [{name: 'Title'}, ...body.columns], items: new Map()});
      return this.reply(201, {id, displayName: body.displayName});
    }
    if ((match = path.match(/^\/sites\/[^/]+\/lists\/([^/]+)\/columns$/))) {
      const list = this.lists.get(match[1])!;
      if (method === 'GET') return this.reply(200, {value: list.columns});
      list.columns.push(body);
      return this.reply(201, body);
    }
    if ((match = path.match(/^\/sites\/[^/]+\/lists\/([^/]+)\/items$/))) {
      const list = this.lists.get(match[1])!;
      if (method === 'GET') return this.reply(200, {value: [...list.items].map(([id, fields]) => ({id, fields: {...fields}}))});
      const id = String(this.nextId++);
      list.items.set(id, {...body.fields});
      return this.reply(201, {id, fields: body.fields});
    }
    if ((match = path.match(/^\/sites\/[^/]+\/lists\/([^/]+)\/items\/([^/]+)(\/fields)?$/))) {
      const list = this.lists.get(match[1])!;
      if (method === 'DELETE') return list.items.delete(match[2]) ? this.reply(204) : this.reply(404, {error: {code: 'itemNotFound'}});
      if (method === 'PATCH') {
        const fields = list.items.get(match[2]);
        if (!fields) return this.reply(404, {error: {code: 'itemNotFound'}});
        Object.assign(fields, body);
        return this.reply(200, fields);
      }
    }
    return this.reply(404, {error: {code: 'notFound', message: `${method} ${path}`}});
  }

  list(name: string): FakeList {
    const list = [...this.lists.values()].find((l) => l.displayName === name);
    if (!list) throw new Error(`no list ${name}`);
    return list;
  }
}
