// Stand-in notification endpoint for the Compose stack. It accepts reminders with the
// bearer token, can refuse the first N requests to test retries, and keeps a short
// in-memory list at /deliveries. Nothing is written to disk.
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

export function createSink({token, failFirst = 0} = {}) {
  let refused = 0;
  const deliveries = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.writeHead(200).end('ok');
    if (req.method === 'GET' && req.url === '/deliveries') {
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify(deliveries.slice(-50)));
    }
    if (req.method !== 'POST' || req.url !== '/notify') return res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end();
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return res.writeHead(413).end();
    }
    if (refused < failFirst) {
      refused++;
      return res.writeHead(503).end();
    }
    const reminder = JSON.parse(body);
    deliveries.push({at: new Date().toISOString(), eventId: reminder.eventId, title: reminder.title});
    console.log(JSON.stringify({at: new Date().toISOString(), eventId: reminder.eventId, delivered: true}));
    res.writeHead(200).end('ok');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.LIFEOS_NOTIFY_TOKEN;
  if (!token || token.length < 16) throw new Error('Set LIFEOS_NOTIFY_TOKEN to a token of at least 16 characters');
  createSink({token, failFirst: Number(process.env.SINK_FAIL_FIRST ?? 0)}).listen(8080, '0.0.0.0');
}
