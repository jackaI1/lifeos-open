import {AppError} from '../shared/errors.mjs';import * as v from '../server/validation.mjs';import {notebookLayout} from '../../public/lecture-layout.js';import {digest} from './store.mjs';
export async function lectureLayoutRoute({store,req,id,json,change}){
 const lecture=await store.get('lecture',id);if(!lecture)throw new AppError('Lecture not found',404);const before=await store.get('lecture-layout',id);
 if(req.method==='GET')return Response.json({item:before});if(req.method!=='PUT')throw new AppError('Method not allowed',405);
 const body=await json(req);v.exactFields(body,['pageIds','hidden','mode','version','mutationId']);const mid=v.mutationId(body.mutationId),fingerprint={layout:id,body},prior=await store.mutation(mid,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);if(v.version(body.version)!==(before?.version??0))throw new AppError('Page order changed on another device. Your layout is retained here.',409,'layout-conflict');let data;try{data=notebookLayout(body);}catch(e){throw new AppError(e.message);}
 const ids=data.pageIds.map(p=>id+'-p-'+p);if(ids.length){const saved=new Set((await store.sql("SELECT id FROM records WHERE kind='lecture-page' AND id>=? AND id<? ORDER BY id LIMIT 501",id+'-p-',id+'-p-~').all()).results.map(r=>r.id));if(ids.some(id=>!saved.has(id)))throw new AppError('Some pages are still saving. Keep this tab open and retry.',409,'layout-pages-pending');}
 const c=change('lecture-layout',id,before,data);return Response.json(await store.commit({id:mid,fingerprint,changes:[c],result:{item:c.after}}));
}
