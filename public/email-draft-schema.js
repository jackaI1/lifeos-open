const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=['to','cc','bcc','subject','body'],keys=['schema','draftId','branchId','parentBranchId','revision','updatedAt','data','source'];
export function draftProblem(value){
 if(!object(value)||Object.keys(value).some(key=>!keys.includes(key))||value.schema!==1||!uuid(value.draftId)||!uuid(value.branchId)||(value.parentBranchId!==undefined&&!uuid(value.parentBranchId))||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))return 'This draft format could not be verified. The original is retained.';
 if(!object(value.data)||Object.keys(value.data).length!==fields.length||fields.some(key=>typeof value.data[key]!=='string'))return 'This draft contains unsupported fields. Your writing is retained.';
 if(fields.slice(0,3).some(key=>value.data[key].length>16000))return 'An address field is over the 16,000 character limit. Your writing is retained; download it.';
 if(value.data.subject.length>500)return 'The subject is over the 500 character limit. Your writing is retained; download it.';
 if(value.data.body.length>100000)return 'The body is over the 100,000 character limit. Your writing is retained; download it.';
 if(value.source!==undefined&&(!object(value.source)||Object.keys(value.source).some(key=>!['source','fixtureVersion','messageId','threadId'].includes(key))||value.source.source!=='fixture'||['fixtureVersion','messageId','threadId'].some(key=>typeof value.source[key]!=='string'||!value.source[key]||value.source[key].length>180)))return 'The sample reply reference could not be verified. The original is retained.';
 if(new TextEncoder().encode(JSON.stringify(value)).byteLength>1048576)return 'This draft is over the 1 MiB device-save limit. Your writing is retained; download it.';
 return null;
}
export function storedDraftProblem(value,key,prefix){const problem=draftProblem(value);if(problem)return problem;return key!==prefix+value.draftId+':'+value.branchId?'The stored draft identity does not match its key. Its original bytes are retained.':null;}
// Raw localStorage exports are exact bytes. Non-JSON structured-clone values
// need a labelled graph representation, not a claim to original database bytes.
export async function retainedWritingText(item){
 if(typeof item.raw==='string')return item.raw;
 const nodes=[],seen=new Map();
 async function encode(value){
  if(value===null||['string','boolean'].includes(typeof value))return value;
  if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0)?value:{type:'number',value:Object.is(value,-0)?'-0':String(value)};
  if(typeof value==='undefined')return {type:'undefined'};
  if(typeof value==='bigint')return {type:'bigint',value:String(value)};
  if(seen.has(value))return {ref:seen.get(value)};
  const id=nodes.length,node={id,type:Object.prototype.toString.call(value).slice(8,-1)};seen.set(value,id);nodes.push(node);
  if(value instanceof Map){node.entries=[];for(const [key,part]of value)node.entries.push([await encode(key),await encode(part)]);}
  else if(value instanceof Set){node.values=[];for(const part of value)node.values.push(await encode(part));}
  else if(value instanceof Date)node.value=Number.isFinite(value.getTime())?value.toISOString():'Invalid Date';
  else if(value instanceof RegExp){node.source=value.source;node.flags=value.flags;}
  else if(value instanceof ArrayBuffer)node.bytes=Array.from(new Uint8Array(value));
  else if(ArrayBuffer.isView(value))node.bytes=Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
  else if(typeof Blob!=='undefined'&&value instanceof Blob){node.mediaType=value.type;node.bytes=Array.from(new Uint8Array(await value.arrayBuffer()));if(typeof value.name==='string'){node.name=value.name;node.lastModified=value.lastModified;}}
  else {node.properties=[];if(Array.isArray(value))node.length=value.length;for(const [key,part]of Object.entries(value))node.properties.push([key,await encode(part)]);if(value instanceof Error)for(const key of ['name','message','stack','cause'])if(key in value&&!node.properties.some(([name])=>name===key))node.properties.push([key,await encode(value[key])]);}
  return {ref:id};
 }
 const root=await encode(item.envelope??item.value);return JSON.stringify({format:'lifeos-retained-structured-writing-v1',backend:item.backend??'unverified-memory',key:item.key,notice:'Structured value representation. Original database record remains unchanged; this is not its physical byte format.',root,nodes},null,2);
}
