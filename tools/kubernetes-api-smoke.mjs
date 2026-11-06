import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Runs inside the real app image via kubectl exec, through the ClusterIP Service.
export async function checkWorkspace({request, phase, id}) {
 assert.ok(['write', 'verify'].includes(phase), 'phase must be write or verify');
 const health = await request('/api/health');
 assert.equal(health.status, 200, 'health endpoint');
 assert.equal((await health.json()).status, 'online');
 const page = await request('/');
 assert.equal(page.status, 200, 'workspace page');
 assert.match(await page.text(), /<html/i);
 const sessionResponse = await request('/api/session');
 assert.equal(sessionResponse.status, 200);
 const session = await sessionResponse.json();
 assert.equal(session.mode, 'demo', 'smoke checks only run on fictional workspaces');
 const path = '/api/private-notes/' + encodeURIComponent(id);
 const data = {title:'Fictional Kubernetes persistence check', text:'This note must survive a replacement pod.'};
 if (phase === 'write') {
  const saved = await request(path, {
   method:'PUT',
   headers:{'content-type':'application/json', origin:'http://127.0.0.1:8787', 'x-lifeos-csrf':session.csrf},
   body:JSON.stringify({version:0, mutationId:crypto.randomUUID(), data}),
  });
  assert.equal(saved.status, 200, 'save a fictional note');
 }
 const loaded = await request(path);
 assert.equal(loaded.status, 200, 'load the same saved note');
 const note = (await loaded.json()).item;
 assert.equal(note.data.title, data.title);
 assert.equal(note.data.text, data.text);
 console.log(`PASS ${phase}: health, workspace page and saved note`);
}

if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
 const request = (path, options = {}) => fetch('http://lifeos:8787' + path, {
  ...options, headers:{Host:'127.0.0.1:8787', ...options.headers}, signal:AbortSignal.timeout(10000),
 });
 const denied = await request('/api/health', {headers:{Host:'untrusted.invalid'}});
 assert.equal(denied.status, 403, 'unexpected hosts must stay blocked');
 await checkWorkspace({request, phase:process.argv[2], id:process.argv[3]});
}
