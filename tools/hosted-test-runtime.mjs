import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildHostedAssets} from './build-hosted-assets.mjs';
const require=createRequire(import.meta.url);
export async function createHostedRuntime({origin='https://demo.example.test',parent='https://owner.example.test',port=0,secure=false}={}){
 const {Miniflare}=await import(require.resolve('miniflare',{paths:[process.env.LIFEOS_WORKER_TOOLCHAIN??process.cwd()]}));
 const modules={'worker.js':{type:'esm',contents:await readFile(resolve('.runtime/hosted/build/worker.js'),'utf8')}};
 const assets=await buildHostedAssets({demoOrigin:origin,parentOrigin:parent});
 const blocked=[];
 const config={name:'demo-test',type:'worker',compatibilityDate:'2026-09-07',manifest:{mainModule:'worker.js',modules},env:{ASSETS:{type:'assets'},DEMO_ORIGIN:{type:'text',value:origin},PARENT_ORIGIN:{type:'text',value:parent}},assets:{directory:assets.directory,runWorkerFirst:['/','/index.html','/api','/api/*','/auth','/auth/*'],htmlHandling:'none',hasUserWorker:true,notFoundHandling:'none'}};
 const mf=new Miniflare({https:secure,host:'127.0.0.1',port,workers:[{config,dev:{outboundService:{type:'fetcher',handler:r=>{blocked.push(new URL(r.url).origin);return new Response('External services are disabled in this test.',{status:502});}}}}]});
 const record=resolve('.runtime/hosted/active-runtime.json');let disposed=false;
 const dispose=async()=>{if(disposed)return;disposed=true;try{await mf.dispose();}finally{await rm(record,{force:true});}};
 try{
  const url=await mf.ready;await mkdir('.runtime/hosted',{recursive:true});
  await writeFile(record,JSON.stringify({owner:'browser-only public demo test runtime',pid:process.pid,processStartedAt:new Date(Date.now()-process.uptime()*1000).toISOString(),fixtureStartedAt:new Date().toISOString(),origin:String(url),port:new URL(url).port,cleanup:'await runtime.dispose() in caller finally; Miniflare stops its owned child processes'}));
  return {mf,blocked,origin,parent,url,dispose};
 }catch(error){await dispose();throw error;}
}
