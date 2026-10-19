// A download is another copy, never a save receipt or permission to remove a row.
// Raw localStorage strings go inside JSON: Blob(raw) would replace lone surrogates.
const MAX_TEXT=4*1024*1024,MAX_JSON=32*1024*1024,MAX_NODES=25000,MAX_DEPTH=64;
function data(object,key){
 const descriptor=Object.getOwnPropertyDescriptor(object,key);
 if(descriptor&&!Object.hasOwn(descriptor,'value'))throw Error('This original contains a getter.');
 return descriptor;
}
function jsonValue(value){
 const seen=new Set();let nodes=0,text=0;
 function count(value){text+=value.length;if(text>MAX_TEXT)throw Error('This original is too large for this download.');}
 function visit(value,depth){
  if(++nodes>MAX_NODES||depth>MAX_DEPTH)throw Error('This original exceeds the safe download limit.');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){count(value);return;}
  if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return;
  if(typeof value!=='object')throw Error('This original has a value that JSON cannot preserve.');
  if(seen.has(value))throw Error('This original has shared or circular values that JSON cannot preserve.');
  seen.add(value);
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(prototype!==(array?Array.prototype:Object.prototype))throw Error('This original has a structured value that this download cannot preserve.');
  const keys=Reflect.ownKeys(value),descriptors=Object.getOwnPropertyDescriptors(value);
  if(array){
   const length=descriptors.length?.value;
   if(!Number.isSafeInteger(length)||length>MAX_NODES||keys.length!==length+1)throw Error('This original has an incomplete or extended array.');
   for(let index=0;index<length;index++){
    const descriptor=descriptors[String(index)];
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw Error('This original has an array value that JSON cannot preserve.');
    visit(descriptor.value,depth+1);
   }
  }else for(const key of keys){
   const descriptor=descriptors[key];
   if(typeof key!=='string'||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw Error('This original has a property that JSON cannot preserve.');
   count(key);visit(descriptor.value,depth+1);
  }
 }
 visit(value,0);
}
export function prepareCookingRecoveryDownload(row,{family='F'}={}){
 try{
  if(!['F','I','J','H'].includes(family)||!row||typeof row!=='object')throw Error('This original is unavailable.');
  const raw=data(row,'raw'),envelope=data(row,'envelope'),value=data(row,'value'),key=data(row,'key'),backend=data(row,'backend');
  const original={};
  for(const [name,descriptor] of [['key',key],['backend',backend]])if(descriptor){
   if(typeof descriptor.value!=='string'||descriptor.value.length>MAX_TEXT)throw Error('This original has unsupported storage metadata.');
   original[name]=descriptor.value;
  }
  let packet;
  if(raw&&typeof raw.value==='string'){
   if(raw.value.length>MAX_TEXT)throw Error('This original is too large for this download.');
   packet={schema:1,family,representation:'raw-local-storage-string',original,raw:raw.value,note:'The raw storage string is encoded inside JSON to preserve every UTF-16 code unit. This download does not remove or acknowledge the original.'};
  }else{
   if(raw&&raw.value!==undefined)throw Error('The raw original is not a supported storage string.');
   const source=envelope?'physical-envelope':'retained-value',selected=envelope??value;
   if(!selected)throw Error('The complete original is unavailable for download.');
   jsonValue(selected.value);
   packet={schema:1,family,representation:'structured-json-value',source,original,value:selected.value,note:'This is a JSON-compatible structured value, not original database bytes. This download does not remove or acknowledge the original.'};
  }
  const json=JSON.stringify(packet,null,2);
  if(json.length>MAX_JSON)throw Error('This original is too large for this download.');
  const blob=new Blob([json],{type:'application/json'});
  if(blob.size>MAX_JSON)throw Error('This original is too large for this download.');
  return{ok:true,representation:packet.representation,filename:'lifeos-cooking-'+family.toLowerCase()+'-recovery.json',blob};
 }catch(error){return{ok:false,reason:error instanceof Error?error.message:'This original cannot be downloaded exactly yet.'};}
}
