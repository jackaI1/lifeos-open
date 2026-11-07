import {pool} from './db.js'; import {processOne} from './queue.js';
let running=true; for(const s of ['SIGINT','SIGTERM']) process.on(s,()=>{running=false;});
while(running) {try {if(!await processOne(pool)) await new Promise(r=>setTimeout(r,1000));} catch(e) {console.error('worker:',e.message); await new Promise(r=>setTimeout(r,1000));}}
await pool.end();
