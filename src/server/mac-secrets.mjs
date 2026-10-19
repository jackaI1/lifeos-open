import {spawn} from 'node:child_process';
import {access,lstat,mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

export const macKeychainHelper=join(homedir(),'Library/Application Support/LifeOS/bin/lifeos-keychain');
const reference = value => value?.kind==='lifeos-keychain' && value.version===1 &&
 Object.keys(value).length===3 && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.account);

async function regularFile(path,{missing=false}={}) {
 try {const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw Error('Mac credentials require a regular file');}
 catch(error){if(!(missing&&error.code==='ENOENT'))throw error;}
}
async function keychain(request) {
 try {
  const s=await lstat(macKeychainHelper);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o022))throw Error();
  await access(macKeychainHelper,constants.X_OK);
 } catch {throw Error('Mac Keychain helper unavailable; run tools/install-mac-keychain.mjs');}
 return new Promise((resolve,reject)=>{
  const child=spawn(macKeychainHelper,[],{env:{HOME:homedir(),PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
  let output='',tooLarge=false;
  const timer=setTimeout(()=>{child.kill();reject(Error('Mac Keychain operation timed out'));},30000);
  child.stdout.on('data',data=>{output+=data;if(Buffer.byteLength(output)>1_048_576){tooLarge=true;child.kill();}});
  child.stderr.resume();
  child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(Error('Mac Keychain helper unavailable'));});
  child.once('close',code=>{clearTimeout(timer);code||tooLarge?reject(Error('Mac Keychain operation failed')):resolve(output);});
  child.stdin.end(JSON.stringify(request));
 });
}
export async function protectMac(path,value) {
 const serialized=JSON.stringify(value);
 if(typeof serialized!=='string'||Buffer.byteLength(serialized)>524288)throw Error('Invalid Mac credential value');
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 await regularFile(path,{missing:true});
 const account=randomUUID(),temporary=path+'.'+randomUUID()+'.tmp';
 await keychain({operation:'add',account,value:serialized});
 try {
  await writeFile(temporary,JSON.stringify({kind:'lifeos-keychain',version:1,account})+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,path);
 } catch(error) {
  await unlink(temporary).catch(()=>{});
  await keychain({operation:'delete',account}).catch(()=>{});
  throw error;
 }
 // Previous entries remain in Keychain for deliberate recovery; never auto-purge credentials.
}
export async function unprotectMac(path) {
 await regularFile(path);
 let stored;
 try {stored=JSON.parse(await readFile(path,'utf8'));} catch {throw Error('Invalid Mac credential reference');}
 if(!reference(stored))throw Error('Invalid Mac credential reference');
 return JSON.parse(await keychain({operation:'get',account:stored.account}));
}
