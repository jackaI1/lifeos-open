import {createHash,randomUUID} from 'node:crypto';
import type {WorkspaceDatabase} from './database.ts';
export class LocalObjects {
 db:WorkspaceDatabase;owner:string;
 constructor(db:WorkspaceDatabase,owner:string){this.db=db;this.owner=owner;db.exec('CREATE TABLE IF NOT EXISTS local_objects(id TEXT PRIMARY KEY, metadata TEXT NOT NULL, content BLOB NOT NULL)');}
 async put(id:string,metadata:Record<string,any>,content:Uint8Array){const meta={modifiedTime:new Date().toISOString(),...metadata,id,size:String(content.length),md5Checksum:createHash('md5').update(content).digest('hex'),shared:false,trashed:false,owners:[{emailAddress:this.owner}]};await this.db.prepare('INSERT INTO local_objects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,content=excluded.content').bind(id,JSON.stringify(meta),content).run();return meta;}
 async fetch(url:string,options:RequestInit={}){
  const target=new URL(url),method=options.method??'GET';
  if(target.pathname==='/drive/v3/files'&&method==='GET'){
   const q=target.searchParams.get('q')??'',parents=[...q.matchAll(/'([^']+)' in parents/g)].map(m=>m[1]);
   let files=(await this.db.prepare('SELECT metadata FROM local_objects ORDER BY id').all()).results.map(r=>JSON.parse(r.metadata));
   if(parents.length)files=files.filter(f=>f.parents?.some((p:string)=>parents.includes(p)));
   if(q.includes("mimeType='application/pdf'"))files=files.filter(f=>f.mimeType==='application/pdf');
   return Response.json({files,incompleteSearch:false});
  }
  if(target.pathname.endsWith('/generateIds'))return Response.json({ids:[randomUUID()]});
  if(target.pathname==='/upload/drive/v3/files'&&method==='POST'){
   const meta=JSON.parse(String(options.body));const id=meta.id??randomUUID();await this.put(id,{...meta,mimeType:meta.mimeType??new Headers(options.headers).get('X-Upload-Content-Type')},new Uint8Array());
   return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/local-upload/'+id}});
  }
  const id=target.pathname.split('/').at(-1)!;
  const row=await this.db.prepare('SELECT * FROM local_objects WHERE id=?').bind(id).first();
  if(target.pathname.startsWith('/local-upload/')&&method==='PUT'&&row){
   const range=new Headers(options.headers).get('content-range');const prior=Buffer.from(row.content);
   if(range?.startsWith('bytes */'))return prior.length>=Number(range.split('/')[1])?Response.json(JSON.parse(row.metadata)):new Response(null,{status:308,headers:prior.length?{range:`bytes=0-${prior.length-1}`}:{}});
   const incoming=new Uint8Array(await new Response(options.body).arrayBuffer());const m=range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);let bytes=incoming;
   if(m){const start=Number(m[1]),end=Number(m[2])+1;const merged=new Uint8Array(Math.max(prior.length,end));merged.set(prior);merged.set(incoming,start);bytes=merged;}
   const meta=await this.put(id,JSON.parse(row.metadata),bytes);
   return m&&bytes.length<Number(m[3])?new Response(null,{status:308,headers:{range:`bytes=0-${bytes.length-1}`}}):Response.json(meta);
  }
  if(!row){const e:any=new Error('Local object not found');e.code='google_not_found';throw e;}
  const meta=JSON.parse(row.metadata);
  if(method==='DELETE'){await this.db.prepare('DELETE FROM local_objects WHERE id=?').bind(id).run();return new Response(null,{status:204});}
  if(method==='PATCH'){await this.put(id,{...meta,...JSON.parse(String(options.body))},row.content);return Response.json(meta);}
  if(target.searchParams.get('alt')==='media'){
   const range=new Headers(options.headers).get('range')?.match(/bytes=(\d+)-(\d+)/);const content=range?row.content.slice(Number(range[1]),Number(range[2])+1):row.content;
   return new Response(content,{status:range?206:200,headers:{'content-type':meta.mimeType??'application/octet-stream'}});
  }
  return Response.json(meta);
 }
}
