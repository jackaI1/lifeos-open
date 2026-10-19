import {validatePage,LECTURE} from './lecture-core.js';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fields=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))throw Error('Unsupported ink change');};
const identifier=s=>typeof s==='string'&&/^[-\w]{1,100}$/.test(s);
export function validateInkPatch(patch,pageId){
 fields(patch,['schemaVersion','meta','strokes','attachments','removedAttachments']);if(patch.schemaVersion!==1)throw Error('Unsupported ink format');
 fields(patch.meta,['width','height','lined','growthStep','epochs','background']);
 if(!Array.isArray(patch.strokes)||!Array.isArray(patch.attachments)||!Array.isArray(patch.removedAttachments)||patch.removedAttachments.length>100||patch.removedAttachments.some(id=>!identifier(id)))throw Error('Invalid ink changes');
 if(patch.strokes.some(s=>s.pageId!==pageId))throw Error('Ink belongs to another page');
 validatePage({schemaVersion:1,...patch.meta,strokes:patch.strokes,attachments:patch.attachments});
 if(new TextEncoder().encode(JSON.stringify(patch)).length>LECTURE.maxPageBytes)throw Error('Ink changes need a smaller upload batch');
 return patch;
}
export function applyInkPatch(page,patch){return applyInkPatches(page,[patch]);}
export function applyInkPatches(page,patches){
 const strokes=new Map((page.strokes??[]).map(s=>[s.id,s])),attachments=new Map((page.attachments??[]).map(a=>[a.id,a])),epochs=new Map((page.epochs??[]).map(e=>[e.epochId,e]));let meta={...page};
 for(const patch of patches){meta={...meta,...patch.meta};for(const s of patch.strokes)strokes.set(s.id,s);for(const id of patch.removedAttachments)attachments.delete(id);for(const a of patch.attachments)attachments.set(a.id,a);for(const e of patch.meta.epochs??[])epochs.set(e.epochId,e);}
 return {...meta,schemaVersion:1,strokes:[...strokes.values()],attachments:[...attachments.values()],epochs:[...epochs.values()]};
}
export function coalesceInkPatches(patches){const merged=applyInkPatches({strokes:[],attachments:[],epochs:[]},patches),removed=new Set();for(const patch of patches){for(const id of patch.removedAttachments)removed.add(id);for(const a of patch.attachments)removed.delete(a.id);}const {schemaVersion,strokes,attachments,epochs,...meta}=merged;return {schemaVersion:1,meta:{...meta,epochs},strokes,attachments,removedAttachments:[...removed]};}
const strokeState=s=>[s,s.hidden,s.width,s.color,s.intent,s.highlightRegions,s.shape,s.graph];
const same=(a,b)=>a?.length===b.length&&a.every((v,i)=>v===b[i]);
// Completed stroke geometry is immutable. Detect only added or changed objects, not every sample in the notebook.
export class InkChangeTracker{
 constructor(page){this.reset(page);}
 reset(page){this.strokes=new Map((page.strokes??[]).map(s=>[s.id,strokeState(s)]));this.length=page.strokes.length;this.dirty=new Set();this.attachments=new Map((page.attachments??[]).map(a=>[a.id,a]));this.height=page.height;this.lined=page.lined;this.background=page.background;this.epochs=new Set((page.epochs??[]).map(e=>e.epochId));}
 mark(stroke){this.dirty.add(stroke);}
 changes(page){const candidates=new Set([...page.strokes.slice(this.length),...this.dirty]),strokes=[...candidates].filter(s=>!same(this.strokes.get(s.id),strokeState(s))),attachments=(page.attachments??[]).filter(a=>this.attachments.get(a.id)!==a),removedAttachments=[...this.attachments.keys()].filter(id=>!page.attachments?.some(a=>a.id===id)),epochs=(page.epochs??[]).filter(e=>!this.epochs.has(e.epochId));if(!strokes.length&&!attachments.length&&!removedAttachments.length&&!epochs.length&&this.height===page.height&&this.lined===page.lined&&this.background===page.background)return null;return {schemaVersion:1,meta:{width:LECTURE.pageWidth,height:page.height,lined:page.lined!==false,...(page.growthStep?{growthStep:page.growthStep}:{}),epochs,...(this.background!==page.background?{background:page.background??null}:{})},strokes,attachments,removedAttachments};}
 // Call synchronously when capturing the patch. The persistence queue retains that immutable copy until durable.
 acknowledge(page,patch){if(!patch){this.reset(page);return;}for(const stroke of patch.strokes)this.strokes.set(stroke.id,strokeState(stroke));this.length=page.strokes.length;this.dirty.clear();for(const a of patch.attachments)this.attachments.set(a.id,a);for(const id of patch.removedAttachments)this.attachments.delete(id);this.height=page.height;this.lined=page.lined;this.background=page.background;for(const e of patch.meta.epochs??[])this.epochs.add(e.epochId);}
}
export function splitInkPatch(patch,{maxBytes=LECTURE.maxPageBytes}={}){
 const bytes=o=>new TextEncoder().encode(JSON.stringify(o)).length,fresh=(first=false)=>({schemaVersion:1,meta:Object.fromEntries(Object.entries(patch.meta).filter(([key])=>first||key!=='background')),strokes:[],attachments:[],removedAttachments:[]});let current=fresh(true),size=bytes(current);const batches=[];if(size>maxBytes)throw Error('Paper metadata exceeds its upload limit');
 const limits={strokes:1500,attachments:4,removedAttachments:100};
 for(const [kind,items]of [['strokes',patch.strokes],['attachments',patch.attachments],['removedAttachments',patch.removedAttachments]])for(const item of items){const length=bytes(item)+1;if(length+bytes(fresh())>maxBytes)throw Error('One ink object exceeds the upload limit. Its device copy is preserved.');if(size+length>maxBytes||current[kind].length>=limits[kind]){batches.push(current);current=fresh();size=bytes(current);}current[kind].push(item);size+=length;}
 if(current.strokes.length||current.attachments.length||current.removedAttachments.length||!batches.length)batches.push(current);return batches;
}
