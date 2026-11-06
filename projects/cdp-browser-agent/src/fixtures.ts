import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function startFixtures() {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><body><h1>Greeting</h1><label for="name">Name</label><input id="name"><button id="submit">Greet</button><p id="result"></p><script>document.querySelector('#submit').onclick=()=>{document.querySelector('#result').textContent='Hello, '+document.querySelector('#name').value+'!'; console.log('greeting made')};</script></body></html>`); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}
