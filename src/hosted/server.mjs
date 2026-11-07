import {healthLog} from './log.mjs';
import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import worker, {validateStaticBindings} from './worker.ts';

const demoOrigin = 'https://demo.example.invalid';
const contentTypes = {
 '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
 '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
 '.json':'application/json', '.webmanifest':'application/manifest+json',
 '.wasm':'application/wasm', '.sql':'text/plain; charset=utf-8',
 '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
 '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
 '.wav':'audio/wav', '.mp4':'video/mp4', '.pdf':'application/pdf'
};

/** Static transport only. No workspace, provider, authentication or database code. */
export function createDemoServer({directory='.runtime/hosted/assets',parentOrigin='https://owner.example.invalid'}={}) {
 const root = resolve(directory);
 const env = {
  DEMO_ORIGIN:demoOrigin, PARENT_ORIGIN:parentOrigin,
  ASSETS:{async fetch(request) {
   try {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const base = await realpath(root), file = await realpath(resolve(root, '.'+path));
    if (!file.startsWith(base+sep)) return new Response(null, {status:404});
    const bytes = await readFile(file);
    return new Response(request.method==='HEAD' ? null : bytes, {
     headers:{'content-type':contentTypes[extname(file)] ?? 'application/octet-stream',
      'cache-control':'public, max-age=0, must-revalidate'}
    });
   } catch { return new Response(null, {status:404}); }
  }}
 };
 validateStaticBindings(env);
 return createServer(async (request, response) => {
  try {
   // Do not trust forwarded origin/cookies, and never read a visitor request body.
   const incoming = new Request(new URL(request.url, demoOrigin), {method:request.method});
   let result;
   if (new URL(incoming.url).pathname==='/healthz' && ['GET','HEAD'].includes(incoming.method)) {
    const shell = await worker.fetch(new Request(demoOrigin+'/index.html'), env);
    result = Response.json({status:shell.ok?'ok':'unavailable',mode:'browser-only'},
     {status:shell.ok?200:503,headers:{'cache-control':'no-store'}});
    console.log(JSON.stringify(healthLog(result.status)));
   } else result = await worker.fetch(incoming, env);
   response.writeHead(result.status, Object.fromEntries(result.headers));
   response.end(request.method==='HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
  } catch {
   response.writeHead(500, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
   response.end(request.method==='HEAD' ? undefined : 'Static demo unavailable');
  }
 });
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const port = Number(process.env.PORT ?? 8080);
 if (!Number.isInteger(port) || port<1 || port>65535) throw Error('Invalid PORT');
 const server = createDemoServer({directory:process.env.LIFEOS_STATIC_DIRECTORY,parentOrigin:process.env.PARENT_ORIGIN});
 server.listen(port, '0.0.0.0', () => console.log(`LifeOS browser-only demo listening on ${port}; pid=${process.pid}`));
 const stop = () => {server.close(); server.closeIdleConnections();};
 process.once('SIGTERM', stop);
 process.once('SIGINT', stop);
}
