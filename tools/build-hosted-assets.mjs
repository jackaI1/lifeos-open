import {cp,mkdir,readFile,writeFile,rm,mkdtemp,rename,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {staticSecurityHeaders,validateStaticBindings} from '../src/hosted/worker.ts';
import {configFromEnv,metaTags} from '../src/analytics/config.ts';

/** Generate deployment assets only; never copy a personal workspace or database. */
export async function buildHostedAssets({source='public',directory='.runtime/hosted/assets',demoOrigin,parentOrigin,requireBrowserEngine=true,analytics=null}={}){
 validateStaticBindings({DEMO_ORIGIN:demoOrigin,PARENT_ORIGIN:parentOrigin,ASSETS:{fetch:async()=>new Response(null)}});
 const sourcePath=resolve(source),output=resolve(directory);
 if(output===sourcePath||sourcePath.startsWith(output+'/')||output.startsWith(sourcePath+'/'))throw Error('Hosted assets need a separate generated directory');
 if(requireBrowserEngine)for(const file of ['vendor/browser-demo/worker.mjs','vendor/browser-demo/client.mjs','vendor/browser-demo/sql-wasm.wasm','vendor/browser-demo/schema.sql'])await readFile(resolve(sourcePath,file));
 await mkdir(dirname(output),{recursive:true});const staged=await mkdtemp(resolve(dirname(output),'assets-stage-'));
 try{
  await cp(sourcePath,staged,{recursive:true,dereference:false,filter:async src=>{if(['.DS_Store','_headers','_redirects','.assetsignore'].includes(src.split('/').at(-1)))return false;if((await lstat(src)).isSymbolicLink())throw Error('Hosted assets cannot include symlinks');return true;}});
  const shell=await readFile(resolve(staged,'index.html'),'utf8');
  if(!/src="\/(?:app|demo-bootstrap)\.js"/.test(shell))throw Error('Demo entrypoint is missing');
  // Product analytics (docs/analytics.md) exists only when real GTM/GA4 ids are supplied at build time.
  const withAnalytics=analytics?shell.replace('</head>',metaTags(analytics)+'</head>'):shell;
  if(analytics&&withAnalytics===shell)throw Error('Demo shell has no </head> to receive analytics configuration');
  if(analytics)await readFile(resolve(staged,'vendor/analytics.mjs'));
  await writeFile(resolve(staged,'index.html'),withAnalytics.replace(/src="\/app\.js"/g,'src="/demo-bootstrap.js"'));
  const headers=staticSecurityHeaders(parentOrigin,analytics!==null);
  await writeFile(resolve(staged,'_headers'),'/*\n'+Object.entries(headers).map(([key,value])=>'  '+key+': '+value).join('\n')+'\n');
  // The destination is generated output owned by this build, never source data.
  await rm(output,{recursive:true,force:true});await rename(staged,output);
  return {directory:output,demoOrigin,parentOrigin,analytics:analytics!==null};
 }finally{await rm(staged,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const configPath=resolve(process.env.LIFEOS_PUBLIC_CONFIG??'wrangler.public.example.jsonc');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 const result=await buildHostedAssets({directory:config.assets.directory,demoOrigin:process.env.DEMO_ORIGIN??config.vars.DEMO_ORIGIN,parentOrigin:process.env.PARENT_ORIGIN??config.vars.PARENT_ORIGIN,analytics:configFromEnv(process.env)});
 console.log('Prepared browser-only demo assets at '+result.directory+(result.analytics?' (analytics enabled)':' (analytics off: no real LIFEOS_GTM_ID)'));
}
