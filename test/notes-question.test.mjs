import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {FakeListChatModel} from '@langchain/core/utils/testing';
import {Embeddings} from '@langchain/core/embeddings';
import {NoteVectorStore} from '../src/notes/vector-store.mjs';
import {askNotes, syncNotes, loadNotes, UNKNOWN} from '../src/notes/questions.mjs';

const feedback='A feedback loop uses the output of a system to influence its next input.';
const optics='A convex lens converges parallel light rays at its focal point.';
class TopicEmbeddings extends Embeddings {
 constructor(){super({});this.calls=0;}
 vector(text){return /feedback|output|input/i.test(text)?[1,0,0]:/lens|light|optics/i.test(text)?[0,1,0]:[0,0,1];}
 async embedDocuments(texts){this.calls++;return texts.map(t=>this.vector(t));}
 async embedQuery(text){return this.vector(text);}
}
function model(evidence){return new FakeListChatModel({responses:[JSON.stringify({evidence})]});}
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'lifeos-notes-'));const embeddings=new TopicEmbeddings();
 const store=new NoteVectorStore(embeddings,{path:join(dir,'vectors.sqlite')});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const notes=[{pageContent:feedback,metadata:{kind:'private-note',id:'feedback',title:'Feedback loops'}},{pageContent:optics,metadata:{kind:'learning-note',id:'optics',title:'Optics'}}];
 await syncNotes(store,notes,{embeddingKey:'fake-v1'});return {store,notes,embeddings,dir};
}
test('answers with a verified source quote and persistent vector retrieval',async t=>{
 const {store,dir,embeddings}=await fixture(t);
 const answer=await askNotes(store,'What does feedback do?',{model:model([{source:1,quote:feedback}])});
 assert.equal(answer.known,true);assert.match(answer.answer,/\[1\]/);assert.equal(answer.citations[0].id,'feedback');assert.equal(answer.citations[0].quote,feedback);
 const reopened=new NoteVectorStore(embeddings,{path:join(dir,'vectors.sqlite')});
 try{const hits=await reopened.similaritySearchWithScore('feedback',1);assert.equal(hits[0][0].metadata.id,'feedback');assert.equal(hits[0][1],1);}finally{reopened.close();}
});
test('unrelated retrieval refuses without calling the language model',async t=>{
 const {store}=await fixture(t);const result=await askNotes(store,'When was Napoleon born?',{model:{invoke(){throw Error('must not generate');}}});
 assert.deepEqual(result,{known:false,answer:UNKNOWN,citations:[]});
});
test('empty index refuses without embedding or generation',async t=>{
 const {store}=await fixture(t);await syncNotes(store,[],{embeddingKey:'fake-v1'});
 const result=await askNotes(store,'feedback',{model:{invoke(){throw Error('must not generate');}}});assert.equal(result.known,false);
});
test('unchanged notes reuse vectors, while edits, deletions and model changes refresh them',async t=>{
 const {store,notes,embeddings}=await fixture(t);assert.equal(embeddings.calls,1);
 await syncNotes(store,notes,{embeddingKey:'fake-v1'});assert.equal(embeddings.calls,1);
 await syncNotes(store,[{...notes[1],pageContent:optics+' Glass bends light.'}],{embeddingKey:'fake-v1'});assert.equal(embeddings.calls,2);
 assert.equal((await askNotes(store,'feedback',{model:model([])})).known,false);
 await syncNotes(store,[notes[0]],{embeddingKey:'fake-v2'});assert.equal(embeddings.calls,3);
});
for(const [name,response] of [
 ['invented quote',[{source:1,quote:'Feedback predicts the future with perfect accuracy.'}]],
 ['invented source',[{source:99,quote:feedback}]],
 ['unanswerable question',[]],
 ['mixed grounded and fabricated output',[{source:1,quote:feedback},{source:1,quote:'A made-up claim.'}]],
])test(name+' produces an unknown answer',async t=>{
 const {store}=await fixture(t);const result=await askNotes(store,'feedback',{model:model(response)});assert.equal(result.known,false);assert.deepEqual(result.citations,[]);
});
test('malformed model output refuses; provider failures remain actionable errors',async t=>{
 const {store}=await fixture(t);
 assert.equal((await askNotes(store,'feedback',{model:new FakeListChatModel({responses:['broken json']})})).known,false);
 await assert.rejects(askNotes(store,'feedback',{model:{invoke(){throw Error('endpoint offline');}}}),/endpoint offline/);
});
test('invalid questions and thresholds are rejected',async t=>{
 const {store}=await fixture(t);
 await assert.rejects(askNotes(store,' ',{model:model([])}),/question/i);
 await assert.rejects(askNotes(store,'feedback',{model:model([]),minScore:NaN}),/score/i);
});
test('workspace loader reads only supported saved text, including transcript segments',async t=>{
 const {dir}=await fixture(t);const path=join(dir,'workspace.sqlite');const db=new DatabaseSync(path);
 db.exec('CREATE TABLE records(kind TEXT,id TEXT,data TEXT)');const put=db.prepare('INSERT INTO records VALUES(?,?,?)');
 put.run('private-note','n',JSON.stringify({title:'My note',text:feedback,document:{text:'duplicate'}}));
 put.run('learning-note','l',JSON.stringify({title:'Lens',text:optics}));
 put.run('lecture-transcript','t',JSON.stringify({lectureId:'lecture-1',segments:[{start:0,end:1,text:'Transcript example text.'}]}));
 put.run('private-journal','secret',JSON.stringify({text:'Do not index journals.'}));
 put.run('private-note','blank',JSON.stringify({title:'Blank',text:''}));db.close();
 const notes=await loadNotes(path);assert.equal(notes.length,3);assert.equal(notes[0].metadata.kind,'learning-note');assert.ok(notes.some(n=>n.pageContent.includes('Transcript example text.')));assert.ok(notes.every(n=>!n.pageContent.includes('Do not index')));
});
test('missing workspace is reported without creating a new database',async t=>{
 const {dir}=await fixture(t);await assert.rejects(loadNotes(join(dir,'missing.sqlite')),/workspace|open/i);
});

test('failed refresh preserves the last complete index and rejects broken embeddings',async t=>{
 const {store,notes,embeddings}=await fixture(t);const before=store.fingerprint();
 embeddings.embedDocuments=async()=>[[1,0]];
 await assert.rejects(syncNotes(store,notes,{embeddingKey:'broken'}),/count/);
 assert.equal(store.fingerprint(),before);assert.equal(store.count(),2);
 await assert.rejects(store.similaritySearchVectorWithScore([1,0],1),/dimension/);
});

test('CLI uses real LangChain Ollama adapters and closes its local protocol fixture',async t=>{
 const {createServer}=await import('node:http');
 const {spawn}=await import('node:child_process');
 const {dir}=await fixture(t);const path=join(dir,'cli-workspace.sqlite');
 const db=new DatabaseSync(path);db.exec('CREATE TABLE records(kind TEXT,id TEXT,data TEXT)');
 db.prepare('INSERT INTO records VALUES(?,?,?)').run('private-note','feedback',JSON.stringify({title:'Feedback loops',text:feedback}));db.close();
 const requests=[];const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;const data=req.url.startsWith('/api/')?JSON.parse(body):{};requests.push({url:req.url,data});
  res.setHeader('content-type','application/json');
  if(req.url==='/info')res.end(JSON.stringify({version:'0.12.0',batch_ingest_config:{use_multipart_endpoint:false}}));
  else if(req.url.startsWith('/runs'))res.end('{}');
  else if(req.url==='/api/embed')res.end(JSON.stringify({embeddings:data.input.map(text=>/feedback|output|input/i.test(text)?[1,0,0]:[0,0,1])}));
  else if(req.url==='/api/chat')res.end(JSON.stringify({model:data.model,created_at:new Date().toISOString(),message:{role:'assistant',content:JSON.stringify({evidence:[{source:1,quote:feedback}]})},done:true,done_reason:'stop',prompt_eval_count:30,eval_count:20}));
  else {res.statusCode=404;res.end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 t.diagnostic(`Owned protocol fixture: PID ${process.pid}, port ${port}; cleanup server.close + closeAllConnections in finally.`);
 try{
  const run=(args,overrides={})=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['src/notes/cli.mjs',...args],{env:{...process.env,LIFEOS_DATABASE:path,NOTES_INDEX:join(dir,'cli-index.sqlite'),OLLAMA_BASE_URL:`http://127.0.0.1:${port}`,LANGSMITH_API_KEY:'fictional-ci-key',LANGSMITH_TRACING:'true',LANGCHAIN_TRACING:'true',LANGSMITH_TRACING_V2:'true',LANGSMITH_ENDPOINT:`http://127.0.0.1:${port}`,LANGCHAIN_ENDPOINT:`http://127.0.0.1:${port}`,...overrides},stdio:['ignore','pipe','pipe'],timeout:10000});
   let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  const answer=await run(['ask','What does feedback do?']);assert.equal(answer.code,0,answer.stderr);assert.match(answer.stdout,/Feedback loops/);assert.match(answer.stdout,/private-note:feedback/);assert.match(answer.stdout,/\[1\]/);
  const unknown=await run(['ask','When was Napoleon born?']);assert.equal(unknown.code,0);assert.match(unknown.stdout,/I don't know/);assert.equal(requests.filter(r=>r.url==='/api/chat').length,1);
  const remote=await run(['index'],{OLLAMA_BASE_URL:'https://example.com'});assert.equal(remote.code,1);assert.match(remote.stderr,/loopback/);
  const invalid=await run(['ask',' ']);assert.equal(invalid.code,1);
  const same=await run(['index'],{NOTES_INDEX:path});assert.equal(same.code,1);assert.match(same.stderr,/different/);
  const indexed=await run(['index']);assert.equal(indexed.code,0);assert.match(indexed.stdout,/unchanged/i);
  assert.equal(requests.filter(r=>r.url==='/api/embed'&&r.data.input[0]===feedback).length,1);
  assert.equal(requests.filter(r=>r.url.startsWith('/runs')).length,0,'note contents must never reach inherited tracing endpoints');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(server.listening,false);}
});
