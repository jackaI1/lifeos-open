// Startup diagnostics only: bounded tail, configured secrets removed before output.
import{readFileSync,openSync,readSync,closeSync,fstatSync,readdirSync}from'node:fs';
const configured={...process.env};
try{for(const line of readFileSync('/data/.env','utf8').split('\n')){const at=line.indexOf('=');if(at>0)configured[line.slice(0,at)]=line.slice(at+1);}}catch{}
const secrets=Object.entries(configured).filter(([key,value])=>/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|COUCH_DB_URL/.test(key)&&value?.length>=4).map(([,value])=>value);
const directory='/root/.pm2/logs';
for(const name of readdirSync(directory).filter(n=>/^app-error.*\.log$/.test(n)).slice(0,2)){
 const fd=openSync(directory+'/'+name,'r');let bytes;
 try{const size=fstatSync(fd).size,buffer=Buffer.alloc(Math.min(size,8192));readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));bytes=buffer.toString('utf8');}finally{closeSync(fd);}
 for(const secret of secrets)bytes=bytes.split(secret).join('[redacted]');
 bytes=bytes.replace(/:\/\/[^/\s@]+@/g,'://[redacted]@').replace(/Bearer\s+[^\s"']+/g,'Bearer [redacted]');
 const lines=bytes.split('\n').filter(line=>/Error|Cannot|missing|failed|ENOENT|EACCES|ENOTFOUND|EADDRINUSE|\.node|\/app\//i.test(line)).slice(-18);
 console.log(name+'\n'+lines.join('\n'));
}
