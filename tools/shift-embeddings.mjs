import{createServer}from'node:http';import{localEmbedder}from'../src/local/retrieval-model.mjs';
const embedder=await localEmbedder();
const server=createServer();
let serial=Promise.resolve();
// Limit inference to one request to avoid multiplying model working memory.
const handler=async(req,res)=>{try{let body='';for await(const chunk of req){body+=chunk;if(body.length>32000)throw Error('Too large');}const {texts}=JSON.parse(body);if(req.method!=='POST'||req.url!=='/embed'||!Array.isArray(texts)||texts.length>32||texts.some(t=>typeof t!=='string'||t.length>4000))throw Error('Invalid input');res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({model:embedder.modelId,vectors:await embedder.embed(texts)}));}catch{res.writeHead(400).end();}};
server.on('request',(req,res)=>{serial=serial.then(()=>handler(req,res));});
server.listen(Number(process.env.EMBED_PORT??8792),'0.0.0.0',()=>console.log('Owned shift embedding fixture pid='+process.pid+'; port='+(process.env.EMBED_PORT??8792)+'; stop=SIGTERM'));
const stop=()=>{server.close(async()=>{await serial;await embedder.close();});server.closeIdleConnections();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
