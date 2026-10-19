import {lstat,realpath} from 'node:fs/promises';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';

const failure=code=>Object.assign(Error(code),{code});
const codeFile=/\.(?:mjs|cjs|js|jsx|ts|tsx|css|html)$/;
const safeRegular=info=>info.isFile()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&info.nlink===1&&info.size<=1_048_576;
const testFile=path=>{
 const parts=path.toLowerCase().split(sep);
 return parts.slice(0,-1).some(part=>['test','tests','__tests__','__mocks__'].includes(part))||/(?:^|[._-])(?:test|spec)(?:[._-]|$)/.test(parts.at(-1));
};

/** Exact selected code files only. This validates tool requests; the coding
 * process still requires OS containment, and only the owner may apply a patch.
 */
export async function createCodeToolPolicy({workspace,readFiles,editFiles}={}){
 let root,reads,edits;
 try{
  if(typeof workspace!=='string'||!isAbsolute(workspace))throw failure('local_coding_policy_rejected');
  root=workspace;
  if(!Array.isArray(readFiles)||!readFiles.length||readFiles.length>64||!Array.isArray(editFiles)||editFiles.length>16)throw failure('local_coding_policy_rejected');
  readFiles=[...readFiles];editFiles=[...editFiles];
  const select=files=>new Set(files.map(file=>{
   if(typeof file!=='string'||/[\x00\r\n]/.test(file))throw failure('local_coding_policy_rejected');
   const path=resolve(root,file),inside=relative(root,path);
   if(!inside||inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside)||inside.split(sep).some(part=>part.startsWith('.'))||!codeFile.test(path))throw failure('local_coding_policy_rejected');
   return path;
  }));
  reads=select(readFiles);edits=select(editFiles);
  if(edits.size!==editFiles.length||reads.size!==readFiles.length||[...edits].some(path=>!reads.has(path)||testFile(path)))throw failure('local_coding_policy_rejected');
  if(await realpath(root)!==root||(await lstat(root)).isSymbolicLink()||!(await lstat(root)).isDirectory())throw failure('local_coding_policy_rejected');
  for(const path of reads)if(!safeRegular(await lstat(path))||await realpath(path)!==path)throw failure('local_coding_policy_rejected');
 }catch{throw failure('local_coding_policy_rejected');}
 function checkTool(call){
  try{
   const name=call?.function?.name;
   if(!['read','edit'].includes(name))throw failure('local_coding_tool_rejected');
   const args=typeof call.function.arguments==='string'?JSON.parse(call.function.arguments):JSON.parse(JSON.stringify(call.function.arguments));
   if(!args||Array.isArray(args)||typeof args.filePath!=='string'||/[\x00\r\n]/.test(args.filePath))throw failure('local_coding_tool_rejected');
   const filePath=resolve(root,args.filePath),allowed=name==='edit'?edits:reads;
   if(!allowed.has(filePath)||name==='edit'&&testFile(filePath)||realpathSync(filePath)!==filePath||!safeRegular(lstatSync(filePath)))throw failure('local_coding_tool_rejected');
   const keys=name==='read'?['filePath','offset','limit']:['filePath','oldString','newString','replaceAll'];
   if(Object.keys(args).some(key=>!keys.includes(key)))throw failure('local_coding_tool_rejected');
   if(name==='read'){
    if(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<1||args.offset>1_000_000)||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>4000))throw failure('local_coding_tool_rejected');
   }else if(typeof args.oldString!=='string'||!args.oldString.length||typeof args.newString!=='string'||Buffer.byteLength(args.oldString)+Buffer.byteLength(args.newString)>60_000||args.replaceAll!==undefined&&typeof args.replaceAll!=='boolean')throw failure('local_coding_tool_rejected');
   return {name,arguments:{...args,filePath}};
  }catch{throw failure('local_coding_tool_rejected');}
 }
 function convertMessages(messages){
  try{
   if(!Array.isArray(messages)||!messages.length||messages.length>64)throw failure('local_coding_messages_rejected');
   return messages.map(message=>{
    if(!['system','user','assistant','tool'].includes(message?.role))throw failure('local_coding_messages_rejected');
    let content=message.content;
    if(Array.isArray(content)){
     if(content.some(part=>part?.type!=='text'||typeof part.text!=='string'))throw failure('local_coding_messages_rejected');
     content=content.map(part=>part.text).join('\n');
    }
    if(content===null||content===undefined)content='';
    if(typeof content!=='string')throw failure('local_coding_messages_rejected');
    const converted={role:message.role,content};
    if(message.tool_calls!==undefined){
     if(message.role!=='assistant'||!Array.isArray(message.tool_calls)||message.tool_calls.length>8)throw failure('local_coding_messages_rejected');
     converted.tool_calls=message.tool_calls.map(call=>({function:checkTool(call)}));
    }
    return converted;
   });
  }catch{throw failure('local_coding_messages_rejected');}
 }
 return {checkTool,convertMessages};
}
