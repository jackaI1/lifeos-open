import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createService} from './service.ts';
const port=Number(process.env.PORT??8787);if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('PORT must be 1024–65535.');
const origin=process.env.APP_ORIGIN??`http://127.0.0.1:${port}`;
const app=await createService({origin});
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end('Host denied');return;}
  const body=['GET','HEAD'].includes(req.method??'GET')?undefined:Readable.toWeb(req) as ReadableStream<Uint8Array>;
  const request=new Request(new URL(req.url??'/',origin),{method:req.method,headers:req.headers as Record<string,string>,body,duplex:'half'} as RequestInit);
  const response=await app.fetch(request);res.writeHead(response.status,Object.fromEntries(response.headers));
  if(!response.body){res.end();return;}for await(const chunk of response.body as any)res.write(chunk);res.end();
 }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Local request failed. Saved drafts are retained.'}));}
});
server.requestTimeout=60000;server.headersTimeout=10000;server.maxHeadersCount=100;
server.listen(port,'127.0.0.1',()=>console.log(`LifeOS standalone ${origin} (PID ${process.pid}; stop with Ctrl-C)`));
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.close(()=>{app.close();process.exitCode=0;});server.closeIdleConnections();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
