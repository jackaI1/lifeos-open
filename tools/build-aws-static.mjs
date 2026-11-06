import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const origin=new URL(process.env.AWS_STATIC_URL??'https://example.invalid');
if(origin.protocol!=='https:'||origin.pathname!=='/')throw Error('AWS_STATIC_URL must be an HTTPS origin');
const config=JSON.parse(await readFile('wrangler.public.example.jsonc','utf8'));
config.vars.DEMO_ORIGIN=origin.origin;
config.vars.PARENT_ORIGIN="https://jacklai.ca";
const file='.runtime/aws-static-config.json';await mkdir('.runtime',{recursive:true});await writeFile(file,JSON.stringify(config));
try{const result=spawnSync(process.execPath,['tools/build-hosted-assets.mjs'],{stdio:'inherit',env:{...process.env,LIFEOS_PUBLIC_CONFIG:file}});if(result.status!==0)throw Error('Public asset build failed');await writeFile('.runtime/hosted/assets/healthz',JSON.stringify({ok:true,commit:process.env.GITHUB_SHA??'local',fictional:true}));}finally{await rm(file,{force:true});}
