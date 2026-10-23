import test from 'node:test';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
test('privacy scanner excludes Git worktree metadata but still catches public private identifiers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fictional-publish-scan-'));try{await mkdir(join(dir,'public'));await writeFile(join(dir,'.git'),'gitdir: /'+'Users/fictional/private/repo/.git/worktrees/example');await writeFile(join(dir,'public','app.js'),'const email="synthetic-person'+'@'+'private.test";');
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/privacy.mjs',import.meta.url))],{cwd:dir,encoding:'utf8'});const j=JSON.parse(r.stdout);assert.equal(r.status,1);assert.deepEqual(j.findings.map(f=>f.file),['public/app.js']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('publishable source scan leaves ignored local request and record directories unread',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fictional-private-scan-'));try{for(const name of ['.lifeos','data','recordings']){await mkdir(join(dir,name));await writeFile(join(dir,name,'synthetic.txt'),'synthetic-person'+'@'+'private.test');}
 const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../tools/privacy.mjs',import.meta.url)),...args],{cwd:dir,encoding:'utf8'});const normal=run([]);assert.equal(normal.status,0);assert.equal(JSON.parse(normal.stdout).files,0);const all=run(['--all']);assert.equal(all.status,1);assert.equal(JSON.parse(all.stdout).findings.length,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
