const origins=(v:string)=>{const u=new URL(v);if(u.origin!==v||!['https:','http:'].includes(u.protocol)||u.username||u.password||u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('Invalid demo origin');return u.origin;};
export function validateDemoBindings(env:Record<string,any>){
 const allowed=new Set(['ASSETS','WORKSPACES','ADMISSION','DEMO_ORIGIN','PARENT_ORIGIN','SESSION_SECRET']);
 if(Object.keys(env).some(k=>!allowed.has(k)))throw Error('Unexpected binding in isolated demo deployment');
 if(origins(env.DEMO_ORIGIN)===origins(env.PARENT_ORIGIN)||typeof env.SESSION_SECRET!=='string'||env.SESSION_SECRET.length<32)throw Error('Invalid isolated demo configuration');
}
const families=['assistant','finances','private-notes','private-friends','private-journal','daily-photos','lectures','lecture-lessons','lecture-permission','lecture-reviews','learning-notes','devotionals','devotional-history','devotional-step','prayer-answers','prayer-dates','prayer-processing-health','deleted','revisions','time-sessions','task-tools','task-brief','reminders','replan','cooking-help','files','uploads','materials'];
const fixedReads=new Set(['/api/session','/api/bootstrap','/api/schedule','/api/health','/api/quota','/api/quota/interactive','/api/releases','/api/database-budget','/api/push/config','/api/notifications/history','/api/journal-history/status','/api/audit','/api/operation-world','/api/export','/api/demo/status','/api/jobs']);
const recordKinds=new Set(['task','calendar-event','settings','meal','project','private-note','private-note-folder','private-friend','private-journal','private-journal-template','devotional','prayer-note','prayer-session','reminder','reminder-list','training','finance-config','finance-transaction','coop-role','coop-profile','presence-correction','schedule-correction']);
export function allowDemoRequest(method:string,path:string){
 if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method)||path.includes('\\')||/%(?:2e|2f|5c|00)/i.test(path))return false;
 if(['GET','HEAD'].includes(method)&&fixedReads.has(path))return true;
 if(path==='/api/demo/reset'||path==='/api/jobs')return method==='POST';
 const rec=path.match(/^\/api\/records\/([^/]+)\/([^/]+)$/);if(rec)return recordKinds.has(rec[1])&&(rec[1]!=='settings'||rec[2]==='preferences');
 if(families.some(k=>path==='/api/'+k||path.startsWith('/api/'+k+'/')))return true;
 if(/^\/api\/jobs\/[A-Za-z0-9_-]+$/.test(path))return ['GET','HEAD'].includes(method);
 return method==='POST'&&/^\/api\/actions\/(?:schedule-entry|personal-calendar|upload-finalize|upload-reconcile|reminder-(?:initialize|save|list-save|undo|staples))$/.test(path);
}
export async function boundRequest(req:Request){
 if(!req.body)return req;
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw Error('Demo request size limit reached');}chunks.push(value);}}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
 const headers=new Headers(req.headers);headers.delete('content-length');headers.delete('cookie');return new Request(req.url,{method:req.method,headers,body:data});
}
export function demoHeaders(response:Response,parent:string){
 const h=new Headers(response.headers);h.delete('x-frame-options');h.set('cache-control','no-store');h.set('referrer-policy','no-referrer');h.set('x-content-type-options','nosniff');
 h.set('content-security-policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${parent}`);
 return new Response(response.body,{status:response.status,headers:h});
}

export const DEMO_JOBS=new Set(['support','assistant','inspire','coop-draft','prayer-process','friend-process','lecture-study','cooking-help','assignment-brief','school-collect','source-sync','devotional-archive','personal-calendar-write']);
