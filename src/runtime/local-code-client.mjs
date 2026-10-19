import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,realpath,lstat,rm,open} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCodeToolPolicy} from './local-coding-policy.mjs';
import {createLocalCodingGateway} from './local-coding-gateway.mjs';
import {completeLocalToolChat} from './local-coding-chat.mjs';
import {runLocalProgram} from './local-program.mjs';

const MODEL='qwen3.8:27b-q4_K_M';
const NODE='./.runtime/local';
const RUNTIME='./.runtime/local';
const OPENCODE=RUNTIME+'/node_modules/.bin/opencode';
const ROOT='./.runtime/local Support/LifeOS/local-agents';
const fail=code=>Object.assign(Error(code),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function codeClientConfig({workspace,readFiles,editFiles,connection}={}){
 try{
  const url=new URL(connection.baseURL);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\d+$/.test(url.port)||Number(url.port)<1024||url.port==='11434'||url.pathname!=='/v1'||url.search||url.hash||url.username||url.password||!/^\w{64}$/.test(connection.token)||!/^[a-f0-9]{64}$/.test(connection.token)||!isAbsolute(workspace)||!Array.isArray(readFiles)||!Array.isArray(editFiles))throw fail('local_code_client_rejected');
  const scope=files=>Object.fromEntries([['*','deny'],...files.flatMap(file=>{const path=resolve(workspace,file);return [[path,'allow'],[path.slice(1),'allow'],[file,'allow']];})]);
  return {$schema:'https://opencode.ai/config.json',model:'ollama/'+MODEL,small_model:'ollama/'+MODEL,enabled_providers:['ollama'],share:'disabled',autoupdate:false,subagent_depth:0,lsp:false,formatter:false,
   provider:{ollama:{npm:'@ai-sdk/openai-compatible',name:'LifeOS scoped local Qwen',options:{baseURL:connection.baseURL,apiKey:connection.token,timeout:600000},models:{[MODEL]:{name:'Local Qwen fixed',limit:{context:8192,output:900}}}}},
   permission:{'*':'deny',read:scope(readFiles),edit:scope(editFiles),task:'deny',external_directory:'deny'},
   agent:{'local-coder':{mode:'primary',description:'Propose a bounded edit to selected isolated source code',model:'ollama/'+MODEL,steps:3,prompt:'Use only read and edit for the explicitly selected code. Preserve tests and all other files. No shell, network, subagents or complete graded deliverables. Changes are proposals; never claim tests ran.'}}};
 }catch{throw fail('local_code_client_rejected');}
}

// OpenCode groups write/apply_patch under its edit permission. Disabling those
// legacy tool flags also disables edit. Keep exact file permissions in the
// client, and expose only the reviewed read/edit schemas to native inference.
export function codeClientRequest(body){
 try{
  const selected=JSON.parse(JSON.stringify(body)),tools=selected.tools===undefined?[]:selected.tools;
  if(!Array.isArray(tools)||tools.length>4||tools.some(tool=>tool?.type!=='function'||!['read','edit','write','apply_patch'].includes(tool.function?.name))||new Set(tools.map(tool=>tool.function.name)).size!==tools.length)throw fail('local_coding_request_rejected');
  return {...selected,tools:tools.filter(tool=>['read','edit'].includes(tool.function.name))};
 }catch{throw fail('local_coding_request_rejected');}
}

export function codeClientEnvironment(workspace){
 return {PATH:dirname(NODE)+':/usr/bin:/bin',HOME:join(workspace,'state/home'),TMPDIR:join(workspace,'state/tmp'),XDG_CONFIG_HOME:join(workspace,'state/config'),XDG_DATA_HOME:join(workspace,'state/data'),XDG_CACHE_HOME:join(workspace,'state/cache'),
  OPENCODE_CONFIG:join(workspace,'opencode.json'),OPENCODE_CONFIG_DIR:join(workspace,'state/config'),OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_DISABLE_AUTOUPDATE:'true',OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_LSP_DOWNLOAD:'true',OPENCODE_DISABLE_CLAUDE_CODE:'true',OPENCODE_DISABLE_AUTOCOMPACT:'true',OPENCODE_DISABLE_PRUNE:'true',OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX:'900',DO_NOT_TRACK:'1',CI:'1'};
}

/** A stopped child alone does not prove that a local proposal completed.
 * Count validated native responses separately from rejected gateway requests.
 */
export function codeClientCompletion(output,metadata){
 try{
  const events=output.split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));
  const finishes=events.filter(event=>event?.type==='step_finish'),last=events.at(-1);
  if(!events.length||events.some(event=>!event||Array.isArray(event)||typeof event.type!=='string'||event.type==='error')||!events.some(event=>event.type==='text'&&typeof event.part?.text==='string'&&event.part.text.trim()||event.type==='tool_use'&&event.part?.state?.status==='completed')||!finishes.length||finishes.some(event=>event.part?.cost!==0)||last?.type!=='step_finish'||last.part?.reason!=='stop')throw fail('local_code_client_run_failed');
  if(!metadata||!['requests','applied','rejected','active'].every(key=>Number.isSafeInteger(metadata[key])&&metadata[key]>=0)||metadata.closed!==true||metadata.active!==0||metadata.applied<1||metadata.requests<metadata.applied||metadata.requests>metadata.applied+metadata.rejected)throw fail('local_code_client_run_failed');
  return {nativeRequests:metadata.applied,gatewayRequests:metadata.requests,gatewayRejectedRequests:metadata.rejected};
 }catch{throw fail('local_code_client_run_failed');}
}

function sandboxPolicy(workspace,editFiles,port,executable){
 const quote=JSON.stringify,ancestors=new Set();
 for(const allowed of [workspace,RUNTIME,dirname(NODE)]){let parent=dirname(allowed);while(parent!=='/'){ancestors.add(parent);parent=dirname(parent);}}
 return `(version 1)\n(allow default)\n(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/Library/Keychains") (subpath "/private/tmp") (subpath "/private/var/folders"))\n(allow file-read-metadata ${[...ancestors].map(path=>'(literal '+quote(path)+')').join(' ')})\n(allow file-read* (subpath ${quote(RUNTIME)}) (subpath ${quote(dirname(NODE))}) (subpath ${quote(workspace)}))\n(deny file-write* (subpath "/Users") (subpath "/private") (subpath "/tmp") (subpath "/var") (subpath "/Volumes") (subpath "/Library"))\n(allow file-write* ${editFiles.map(file=>'(literal '+quote(resolve(workspace,file))+')').join(' ')} (subpath ${quote(join(workspace,'state'))}) (literal "/dev/null"))\n(deny network*)\n(allow network-outbound (remote ip "localhost:${port}"))\n(deny process-exec)\n(allow process-exec (literal ${quote(executable)}))\n`;
}

/** Caller prepares a fresh isolated code-only copy. Originals outside this
 * workspace cannot be read/written by the child; edits never apply themselves.
 * Each native request uses the reviewed shared admission and tool policy.
 */
export async function runScopedCodeClient(options={}){
 let gateway,configPath,canary,probePath,result,error,nativeUncertain=false;const ownedCleanup=new Map();
 // Hold the creation handle so an unlinked inode cannot be reused beneath a
 // pathname-only ownership check. Changed bytes and replacements are retained.
 const writeOwned=async(path,value)=>{
  const bytes=Buffer.from(value),handle=await open(path,'wx+',0o600),artifact={handle,identity:null,bytes};
  ownedCleanup.set(path,artifact);artifact.identity=await handle.stat();await handle.writeFile(bytes);
 };
 try{
  const {workspace,readFiles,editFiles,prompt,synthetic=false}=JSON.parse(JSON.stringify({workspace:options.workspace,readFiles:options.readFiles,editFiles:options.editFiles,prompt:options.prompt,synthetic:options.synthetic??false}));
  if(process.platform!=='darwin'||typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>10000||!(synthetic===true&&/^\/private\/tmp\/lifeos-code-client-[A-Za-z0-9_-]+$/.test(workspace)||synthetic===false&&dirname(workspace)===ROOT&&/^delegation-[A-Za-z0-9_-]+$/.test(workspace.slice(ROOT.length+1))))throw fail('local_code_client_rejected');
  const info=await lstat(workspace);if(await realpath(workspace)!==workspace||!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o777)!==0o700)throw fail('local_code_client_rejected');
  const policy=await createCodeToolPolicy({workspace,readFiles,editFiles}),before=new Map();
  for(const file of readFiles)before.set(file,hash(await readFile(resolve(workspace,file))));
  await mkdir(join(workspace,'state'),{mode:0o700});for(const name of ['home','tmp','config','data','cache'])await mkdir(join(workspace,'state',name),{mode:0o700});
  gateway=createLocalCodingGateway({...policy,completeImpl:async(body,control)=>{
   try{return await completeLocalToolChat(codeClientRequest(body),{...control,...(options.localChatImpl?{localChatImpl:options.localChatImpl}:{})});}
   catch(cause){if(cause?.code==='local_inference_uncertain')nativeUncertain=true;throw cause;}
  }});
  const connection=await gateway.listen(),executable=await realpath(OPENCODE),port=Number(new URL(connection.baseURL).port);
  configPath=join(workspace,'opencode.json');await writeOwned(configPath,JSON.stringify(codeClientConfig({workspace,readFiles,editFiles,connection})));
  const runProfile=join(workspace,'client.sb'),proofProfile=join(workspace,'proof.sb');
  await writeFile(runProfile,sandboxPolicy(workspace,editFiles,port,executable),{mode:0o600,flag:'wx'});await writeFile(proofProfile,sandboxPolicy(workspace,editFiles,port,NODE),{mode:0o600,flag:'wx'});
  canary=join(dirname(workspace),'synthetic-denied-'+randomUUID()+'.mjs');await writeOwned(canary,'// disposable containment canary');
  probePath=join(workspace,'.sandbox-proof.mjs');
  const probe=`import{readFile,writeFile}from'node:fs/promises';import net from'node:net';const r={};const denied=e=>['EPERM','EACCES'].includes(e.code);try{await readFile(${JSON.stringify(resolve(workspace,readFiles[0]))});r.selectedRead=true;}catch{r.selectedRead=false;}try{await readFile(${JSON.stringify(canary)});r.outsideRead=false;}catch(e){r.outsideRead=denied(e);}try{await writeFile(${JSON.stringify(resolve(workspace,readFiles.find(file=>!editFiles.includes(file))||'opencode.json'))},'UNEXPECTED_WRITE');r.immutableWrite=false;}catch(e){r.immutableWrite=denied(e);}const connect=(host,port)=>new Promise(resolve=>{const s=net.createConnection({host,port});const timer=setTimeout(()=>{s.destroy();resolve('timeout');},1500);s.once('connect',()=>{clearTimeout(timer);s.destroy();resolve('connected');});s.once('error',e=>{clearTimeout(timer);resolve(denied(e)?'denied':'other');});});r.gateway=(await connect('127.0.0.1',${port}))==='connected';r.directNative=(await connect('127.0.0.1',11434))==='denied';r.external=(await connect('198.51.100.1',443))==='denied';r.ipv6=(await connect('::1',11434))==='denied';console.log(JSON.stringify(r));`;
  await writeOwned(probePath,probe);
  const env=codeClientEnvironment(workspace),spawnImpl=(command,args,control)=>spawn(command,args,{...control,env,cwd:workspace});
  const proof=JSON.parse(await runLocalProgram('/usr/bin/sandbox-exec',['-f',proofProfile,NODE,probePath],{timeoutMs:10000,maxOutput:50000,spawnImpl}));
  if(Object.keys(proof).length!==7||Object.values(proof).some(value=>value!==true))throw fail('local_code_containment_failed');
  const output=await runLocalProgram('/usr/bin/sandbox-exec',['-f',runProfile,executable,'run',prompt,...readFiles.flatMap(file=>['--file',resolve(workspace,file)]),'--pure','--format','json','--agent','local-coder','--model','ollama/'+MODEL,'--title','LifeOS selected local code proposal'],{timeoutMs:300000,maxOutput:2000000,spawnImpl});
  let changedFiles=0,testsUnchanged=true;
  for(const file of readFiles){const changed=hash(await readFile(resolve(workspace,file)))!==before.get(file);if(changed&&!editFiles.includes(file))testsUnchanged=false;if(changed)changedFiles++;}
  if(!testsUnchanged)throw fail('local_code_immutable_changed');
  await gateway.close();
  result={status:'local-code-proposal-prepared',model:MODEL,sandboxPassed:true,originalsWritable:false,testsUnchanged,changedFiles,...codeClientCompletion(output,gateway.metadata()),cloudCalls:0,appliedToRepository:false,testsRun:false};
 }catch(cause){error=fail(['local_code_client_rejected','local_code_containment_failed','local_code_immutable_changed','local_inference_uncertain'].includes(cause?.code)?cause.code:'local_code_client_run_failed');}
 let cleanupRequired=false;
 try{if(gateway)await gateway.close();}catch{error??=fail('local_code_client_run_failed');cleanupRequired=true;}
  for(const [path,{handle,identity,bytes}] of ownedCleanup){
  try{
   if(!identity)throw fail('local_code_client_cleanup_failed');
   const same=info=>info.isFile()&&info.dev===identity.dev&&info.ino===identity.ino&&info.uid===identity.uid&&info.nlink===1&&(info.mode&0o777)===0o600&&info.size===bytes.length;
   if(!same(await lstat(path))||!same(await handle.stat()))throw fail('local_code_client_cleanup_failed');
   const actual=Buffer.alloc(bytes.length+1),read=await handle.read(actual,0,actual.length,0);
   if(read.bytesRead!==bytes.length||!actual.subarray(0,read.bytesRead).equals(bytes)||!same(await lstat(path)))throw fail('local_code_client_cleanup_failed');
   await rm(path);
  }catch{cleanupRequired=true;}
  finally{try{await handle.close();}catch{cleanupRequired=true;}}
 }
 if(nativeUncertain)error=fail('local_inference_uncertain');
 if(cleanupRequired){error??=fail('local_code_client_cleanup_failed');error.cleanupRequired=true;}
 if(error)throw error;
 return result;
}
