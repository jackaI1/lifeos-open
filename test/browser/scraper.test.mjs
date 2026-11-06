import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventory} from '../../tools/page-inventory.mjs';

test('inventory obeys robots, retries, and replaces results without duplicates', async () => {
 let attempts = 0; const seen = [];
 const server = createServer((req,res) => {
  seen.push(req.url);
  if (req.url === '/robots.txt') return res.end('User-agent: *\nDisallow: /private\n');
  if (req.url === '/retry' && ++attempts === 1) { res.statusCode = 503; return res.end('retry'); }
  res.setHeader('content-type','text/html'); res.end('<title>Public page</title><h1>Hello</h1>');
 });
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const dir = await mkdtemp(join(tmpdir(),'lifeos-inventory-')); const output = join(dir,'inventory.json');
 try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let i=0;i<2;i++) await inventory({base, paths:['/retry','/private'], output, delayMs:10});
  const rows = JSON.parse(await readFile(output,'utf8'));
  assert.equal(rows.length,1); assert.equal(rows[0].title,'Public page');
  assert.equal(attempts,3); assert.equal(seen.includes('/private'),false);
 } finally { await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true}); }
});
