// HTTP front door for the read-only schedule API. It listens on loopback only, needs a bearer
// token, accepts POST /graphql with JSON, and bounds the body size. Introspection stays on
// because every caller already holds the token.
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {pathToFileURL} from 'node:url';
import {LIMITS, runQuery} from './schedule.ts';
import type {ReadDatabase} from '../mcp/readonly.ts';

const MAX_BODY_BYTES = 8192;

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  response.end(JSON.stringify(body));
}

export function createGraphqlServer(db: ReadDatabase, {token, timeZone = 'America/Toronto', now}: {token: string; timeZone?: string; now?: () => number}) {
  if (token.length < 24) throw Error('The GraphQL token must be at least 24 characters.');
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== '/graphql') return send(response, 404, {errors: [{message: 'Not found.'}]});
    if (request.method !== 'POST') return send(response, 405, {errors: [{message: 'Use POST with a JSON body.'}]});
    if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, {errors: [{message: 'Authentication required.'}]});
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return send(response, 415, {errors: [{message: 'Send application/json.'}]});
    let raw = '';
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return send(response, 413, {errors: [{message: 'Request body is too large.'}]});
        raw += chunk;
      }
      const parsed = JSON.parse(raw) as {query?: unknown; variables?: unknown};
      const outcome = await runQuery(db, parsed, {timeZone, now: now?.()});
      return send(response, outcome.status, outcome.body);
    } catch {
      return send(response, 400, {errors: [{message: 'Send a JSON body with a query string.'}]});
    }
  });
}

export {LIMITS};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.LIFEOS_GRAPHQL_DATABASE;
  const token = process.env.LIFEOS_GRAPHQL_TOKEN ?? '';
  if (!file) throw Error('Set LIFEOS_GRAPHQL_DATABASE to the workspace file to read.');
  const {LocalDatabase} = await import('../local/database.ts');
  const db = new LocalDatabase(file, {readOnly: true});
  const server = createGraphqlServer(db, {token, timeZone: process.env.LIFEOS_TIME_ZONE});
  const port = Number(process.env.PORT ?? 4000);
  server.listen(port, '127.0.0.1', () => console.log(`schedule GraphQL on http://127.0.0.1:${port}/graphql`));
  const stop = () => { server.close(); db.db.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
