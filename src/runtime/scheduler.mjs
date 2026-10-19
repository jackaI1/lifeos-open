import{readFile}from'node:fs/promises';import{resolve,join}from'node:path';import{Store}from'../server/store.mjs';import{scheduleTick}from'./schedule.mjs';
const config=JSON.parse(await readFile(resolve(process.env.LIFEOS_CONFIG??'.lifeos/production/config.json'),'utf8')),store=new Store(join(config.dataDir,'lifeos.sqlite'));let stopping=false;
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});console.log(JSON.stringify({service:'lifeos-scheduler',environment:config.environment,status:'started'}));
while(!stopping){try{const result=scheduleTick({store,config});store.heartbeat('scheduler',result,true);}catch{store.heartbeat('scheduler',{status:'failed',message:'Schedule evaluation needs review'});}await new Promise(r=>setTimeout(r,30000));}store.close();
