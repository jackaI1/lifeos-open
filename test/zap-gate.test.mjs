import test from'node:test';import assert from'node:assert/strict';import{readFile,mkdtemp,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{spawnSync}from'node:child_process';
test('ZAP gate accepts only exact reviewed evidence and fails new medium or high alerts',async()=>{
 const [known]=JSON.parse(await readFile('security/zap-baseline.json','utf8')),dir=await mkdtemp(join(tmpdir(),'lifeos-zap-gate-'));
 try{for(const [alertRef,evidence,riskcode,expected,pathName]of [[known.alertRef,known.evidence,'2',0],[known.alertRef,known.evidence+"; script-src 'unsafe-inline'",'2',1],['new-rule','new','3',1],['low-rule','low','1',0],[known.alertRef,known.evidence,'2',1,'/unreviewed']]){
  const path=join(dir,'report.json');await writeFile(path,JSON.stringify({site:[{alerts:[{alertRef,name:'test finding',riskcode,instances:[{evidence,uri:'http://127.0.0.1:8080'+(pathName??'/')}]}]}]}));const run=spawnSync(process.execPath,['security/check-zap.mjs',path],{encoding:'utf8'});assert.equal(run.status,expected,run.stderr+run.stdout);
 }}finally{await rm(dir,{recursive:true,force:true});}
});
