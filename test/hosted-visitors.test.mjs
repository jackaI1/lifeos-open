import test from 'node:test';import assert from 'node:assert/strict';
const secret='synthetic-demo-key-'.repeat(3);
async function modules(){const v=await import('../src/hosted/visitor.ts').catch(()=>({}));assert.equal(typeof v.signVisitor,'function','signed visitor capability missing');return {...v,...await import('../src/hosted/policy.ts')};}
test('signed visitor cookies reject forgery, expiry and query selectors',async()=>{
 const m=await modules(),now=100000000;const token=await m.signVisitor('a'.repeat(43),secret,now);const req=new Request('https://demo.example.test/?visitor=someone-else',{headers:{cookie:'__Host-lifeos-demo='+token}});
 assert.equal((await m.parseVisitorCookie(req,secret,now+1000)).id,'a'.repeat(43));assert.equal(await m.parseVisitorCookie(req,secret,now+86400001),null);
 assert.equal(await m.parseVisitorCookie(new Request(req.url,{headers:{cookie:'__Host-lifeos-demo='+token.slice(0,-4)+'AAAA'}}),secret,now),null);
 assert.equal(await m.parseVisitorCookie(new Request(req.url),secret,now),null);
});
test('public route and environment policy exclude actual integrations and personal bindings',async()=>{
 const m=await modules();for(const path of ['/api/worker/claim','/auth/google','/api/presence','/api/actions/cloud-sync','/api/actions/release','/api/records/provider-state/google'])assert.equal(m.allowDemoRequest('POST',path),false,path);
 for(const [method,path]of [['GET','/api/session'],['GET','/api/bootstrap'],['GET','/api/lectures'],['PUT','/api/records/private-note/example'],['POST','/api/assistant/threads'],['POST','/api/actions/reminder-save']])assert.equal(m.allowDemoRequest(method,path),true,path);
 assert.throws(()=>m.validateDemoBindings({DEMO_ORIGIN:'https://demo.example.test',PARENT_ORIGIN:'https://owner.example.test',SESSION_SECRET:secret,DB:{}}));
 assert.throws(()=>m.validateDemoBindings({DEMO_ORIGIN:'https://demo.example.test',PARENT_ORIGIN:'https://demo.example.test',SESSION_SECRET:secret}));
});
test('streaming request limits reject bytes even when Content-Length is absent',async()=>{
 const m=await modules();const req=new Request('https://demo.example.test/api/assistant/threads',{method:'POST',body:new Uint8Array(1048577)});await assert.rejects(()=>m.boundRequest(req),/size limit/i);
 const good=await m.boundRequest(new Request(req.url,{method:'POST',body:'{}'}));assert.equal(await good.text(),'{}');
});
