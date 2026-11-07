import { createServer } from 'node:http';
import sirv from 'sirv';
import { createSignallingServer } from './signalling';

const production = process.env.NODE_ENV === 'production';
const vite = production ? null : await (await import('vite')).createServer({server:{middlewareMode:true},appType:'spa'});
const staticFiles = sirv('dist', { etag: true, maxAge: 0 });
let iceServers: RTCIceServer[] = [];
if (process.env.ICE_SERVERS_JSON) iceServers = JSON.parse(process.env.ICE_SERVERS_JSON);
const http = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url === '/config.json') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({iceServers})); return;
  }
  if (vite) vite.middlewares(req,res);
  else staticFiles(req,res, () => { res.statusCode = 404; res.end('Not found. Run npm run setup:models if a model asset is missing.'); });
});
const signalling = createSignallingServer(http);
const port = Number(process.env.PORT ?? 4173), host = process.env.HOST ?? '127.0.0.1';
http.listen(port,host, () => console.log(JSON.stringify({
  owner:'webrtc-captioned-call', pid:process.pid, startedAt:new Date().toISOString(),
  url:`http://${host}:${port}`, cleanup:`kill -TERM ${process.pid}`,
})));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await signalling.close(); await vite?.close();
  http.close(() => process.exit(0));
  http.closeIdleConnections();
}
process.on('SIGTERM', close); process.on('SIGINT', close);
