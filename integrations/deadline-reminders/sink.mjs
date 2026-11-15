// Stand-in for the reminder destination during tests and local tries. It accepts the reminder
// payload, keeps a count, and can fail its first N requests so the retry path can be checked.
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export function createSink({failFirst = 0} = {}) {
  const received = [];
  const claimed = new Set();
  let failures = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/stats') {
      response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({received: received.length, failures, items: received}));
      return;
    }
    if (request.method === 'POST' && request.url === '/claim') {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      try {
        const {id} = JSON.parse(raw);
        if (typeof id !== 'string' || !id || id.length > 200) throw Error('bad id');
        const accepted = !claimed.has(id);
        claimed.add(id);
        response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({accepted}));
      } catch {
        response.writeHead(400).end();
      }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/notify') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) {
        response.writeHead(413).end();
        return;
      }
    }
    if (failures < failFirst) {
      failures++;
      response.writeHead(503).end();
      return;
    }
    try {
      const payload = JSON.parse(body);
      if (payload.route !== 'reminders' || typeof payload.title !== 'string') throw Error('bad payload');
      received.push({id: payload.id, title: payload.title, dueAt: payload.dueAt ?? null});
      response.writeHead(200, {'content-type': 'application/json'}).end('{"ok":true}');
    } catch {
      response.writeHead(400).end();
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8099);
  const server = createSink({failFirst: Number(process.env.FAIL_FIRST ?? 0)});
  server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`reminder sink listening on ${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
