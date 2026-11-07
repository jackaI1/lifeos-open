import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Dockerfile is multi-stage, non-root and has a healthcheck',async()=>{
 const file=await read('Dockerfile');
 const stages=[...file.matchAll(/^FROM\s+\S+\s+AS\s+([\w-]+)/gim)].map((m)=>m[1]);
 assert.deepEqual(stages.slice(0,2),['deps','build']);
 assert.equal(stages.at(-1),'runtime','the default target must remain the standalone workspace');
 assert.ok(stages.includes('public-demo'),'AWS needs the shared static target');
 const runtime=file.slice(file.search(/^FROM\s+\S+\s+AS\s+runtime/im));
 assert.match(runtime,/^USER\s+node$/m,'runtime stage must drop root');
 assert.match(runtime,/^HEALTHCHECK\b/m);
 assert.match(runtime,/\/api\/health/);
 assert.match(runtime,/LIFEOS_BIND_HOST=0\.0\.0\.0/);
 assert.match(runtime,/LIFEOS_DATABASE=\/data\//);
 assert.match(runtime,/rm -rf \/usr\/local\/lib\/node_modules/,'package managers must be removed from the runtime');
 assert.doesNotMatch(runtime,/npm ci|esbuild/,'dev tooling must stay out of the runtime stage');
 assert.doesNotMatch(file,/^(ENV|ARG)\s+\S*(TOKEN|SECRET|PASSWORD|API_KEY)\S*=\S+/im,'no credentials baked into the image');
});

test('.dockerignore keeps local state and secrets out of the build context',async()=>{
 const lines=(await read('.dockerignore')).split('\n').map((l)=>l.trim());
 for(const entry of ['.git','node_modules','.env','.env.*','.local','*.sqlite','backups'])assert.ok(lines.includes(entry),entry+' must be ignored');
 assert.ok(lines.includes('!.env.example'));
});

test('compose runs the runtime target on loopback with a persistent data volume',async()=>{
 const file=await read('docker-compose.yml');
 assert.match(file,/target:\s*runtime/);
 assert.match(file,/-\s*"127\.0\.0\.1:8787:8787"/,'published port must be loopback and match the container port');
 assert.match(file,/lifeos-data:\/data/);
 assert.match(file,/^volumes:\n\s+lifeos-data:/m);
 assert.match(file,/profiles:\s*\["postgres"\]/);
 assert.match(file,/image:\s*ghcr\.io\/jackai1\/lifeos-open:/);
});

test('server bind host is configurable but defaults to loopback',async()=>{
 const main=await read('src/local/main.ts');
 assert.match(main,/LIFEOS_BIND_HOST\?\?'127\.0\.0\.1'/);
 assert.match(main,/server\.listen\(port,bindHost,/);
});

test('docker workflow builds on PRs, scans with Trivy and publishes checked main and tags to GHCR',async()=>{
 const wf=await read('.github/workflows/docker.yml');
 assert.match(wf,/pull_request:/);
 assert.match(wf,/tags:\s*\[?\s*['"]?v\*/);
 assert.match(wf,/aquasecurity\/trivy:/);
 assert.match(wf,/ghcr\.io\/jackai1\/lifeos-open/);
 assert.match(wf,/if:.*github\.event_name == 'push'.*refs\/heads\/main/);
 assert.match(wf,/docker run --name lifeos-suite lifeos-tests make test/);
 assert.match(wf,/trap cleanup EXIT/);
 assert.match(wf,/packages:\s*write/);
 assert.equal((wf.match(/packages:\s*write/g)??[]).length,1,'only the publish job may write packages');
});
