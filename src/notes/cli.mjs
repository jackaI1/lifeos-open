// Never send note contents to an inherited LangSmith tracing configuration.
for(const key of ['LANGSMITH_TRACING','LANGSMITH_TRACING_V2','LANGCHAIN_TRACING','LANGCHAIN_TRACING_V2','LANGCHAIN_VERBOSE'])process.env[key]='false';
import {resolve, dirname, join} from 'node:path';
import {stat} from 'node:fs/promises';
import {ChatOllama, OllamaEmbeddings} from '@langchain/ollama';
import {NoteVectorStore} from './vector-store.mjs';
import {loadNotes, syncNotes, askNotes} from './questions.mjs';

const help=`Ask questions of saved LifeOS notes (local SQLite edition).
  npm run notes -- index
  npm run notes -- ask "How does feedback work?"

Run LifeOS once first and save notes under Notes or School.
Setup and options: docs/notes-questions.md`;
async function main(){
 const [command,...words]=process.argv.slice(2);
 if(!command||command==='help'||command==='--help'){console.log(help);return;}
 if(!['index','ask'].includes(command))throw Error(help);
 const question=words.join(' ').trim();
 if(command==='ask'&&(!question||question.length>2000))throw Error('Question must contain 1 to 2000 characters.');
 if(command==='index'&&words.length)throw Error('Index takes no extra arguments.');
 if(process.env.DATABASE_URL)throw Error('Notes questions currently read a local SQLite workspace. Unset DATABASE_URL and choose LIFEOS_DATABASE explicitly.');
 const baseUrl=new URL(process.env.OLLAMA_BASE_URL??'http://127.0.0.1:11434');
 if(baseUrl.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(baseUrl.hostname)||baseUrl.username||baseUrl.password||baseUrl.pathname!=='/'||baseUrl.search||baseUrl.hash)throw Error('OLLAMA_BASE_URL must be an HTTP loopback address with no credentials or path.');
 const database=resolve(process.env.LIFEOS_DATABASE??'.local/workspace.sqlite');
 const index=resolve(process.env.NOTES_INDEX??join(dirname(database),'notes-index.sqlite'));
 const workspaceStat=await stat(database).catch(()=>{throw Error('Workspace not found. Run npm run dev once, or set LIFEOS_DATABASE to an existing SQLite workspace.');});
 const indexStat=await stat(index).catch(()=>null);
 if(database===index||(indexStat&&workspaceStat.dev===indexStat.dev&&workspaceStat.ino===indexStat.ino))throw Error('Notes index and workspace must use different files.');
 const minScore=Number(process.env.NOTES_MIN_SCORE??0.65);
 if(!Number.isFinite(minScore)||minScore<0||minScore>1)throw Error('NOTES_MIN_SCORE must be between 0 and 1.');
 const embeddingModel=process.env.NOTES_EMBED_MODEL??'nomic-embed-text';
 const chatModel=process.env.NOTES_CHAT_MODEL??'qwen2.5:1.5b';
 // Refuse redirects and bound requests; only the explicitly selected loopback server receives text.
 const localFetch=(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(120000)});
 const embeddings=new OllamaEmbeddings({baseUrl:baseUrl.origin,model:embeddingModel,keepAlive:0,maxRetries:0,fetch:localFetch});
 const model=new ChatOllama({baseUrl:baseUrl.origin,model:chatModel,temperature:0,format:'json',keepAlive:0,maxRetries:0,numPredict:512,fetch:localFetch});
 const notes=await loadNotes(database);
 const store=new NoteVectorStore(embeddings,{path:index});
 try{
  const status=await syncNotes(store,notes,{embeddingKey:baseUrl.origin+'/'+embeddingModel});
  if(command==='index'){console.log(`${notes.length} notes, ${status.chunks} passages. Index ${status.changed?'refreshed':'unchanged'}.`);return;}
  const result=await askNotes(store,question,{model,minScore});console.log(result.answer);
  for(const [i,c] of result.citations.entries())console.log(`[${i+1}] ${c.title} (${c.kind}:${c.id}, passage ${c.chunk})`);
 }finally{store.close();}
}
main().catch(error=>{console.error(`Notes questions: ${error.message}\nCheck Ollama is running and both models are installed. See docs/notes-questions.md.`);process.exitCode=1;});
