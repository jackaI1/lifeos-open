import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,readdir,realpath,stat,statfs,copyFile,rename,access} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root,path) => {const rel=relative(resolve(root),resolve(path));return rel!==''&&rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
const exists = async path => {try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const check = signal => {if(signal?.aborted)throw Object.assign(new Error('Backup stopped; completed local files remain preserved'),{code:'cancelled'});};
const safeKey = value => {if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value??''))throw new Error('A stable backup ID is required');return value;};
const skippedNames = new Set(['node_modules','.venv','venv','__pycache__','synthetic-audio','models','model','tools','.git']);
const selectedRoots = ['uploads','files','prayer-artifacts','imports','coursework','journals','exports'];

export async function fileSha256(path){const h=createHash('sha256');for await(const part of createReadStream(path))h.update(part);return h.digest('hex');}

async function walk(root,directory,files,signal){
  if(!await exists(directory))return;
  for(const item of await readdir(directory,{withFileTypes:true})){
    check(signal);if(item.isSymbolicLink())throw new Error('Backup refuses linked private files');
    if(skippedNames.has(item.name)||/^(?:recording\.media|decoded\.wav)$/.test(item.name))continue;
    const path=join(directory,item.name),actual=await realpath(path);if(!inside(root,actual))throw new Error('Backup file escaped its private directory');
    if(item.isDirectory())await walk(root,path,files,signal);
    else if(item.isFile())files.add(actual);
  }
}

/** Consistent SQLite snapshot plus immutable private source/capture files. Credentials and tool installs are excluded. */
export async function createLocalBackup({store,config,id,signal}){
  safeKey(id);const root=await realpath(config.dataDir),backupRoot=join(root,'backups');await mkdir(backupRoot,{recursive:true});
  if(!inside(root,await realpath(backupRoot)))throw new Error('Backup directory escaped private storage');
  const directory=join(backupRoot,id),manifestPath=join(directory,'manifest.json');
  if(await exists(manifestPath)){const manifest=await verifyLocalBackup(directory);return {directory,manifest,reused:true};}
  if(await exists(directory))throw new Error('An incomplete backup needs inspection before retry');
  // Keep abandoned staging directories for inspection. Never replace a previous backup.
  const staging=join(backupRoot,`${id}-staging-${Date.now()}`);await mkdir(staging);check(signal);
  const database=join(staging,'lifeos.sqlite'),integrity=await store.backup(database);check(signal);
  const snapshot=new DatabaseSync(database,{readOnly:true});let chunks;const prayerStates=new Map();
  try{chunks=snapshot.prepare('SELECT session_id,chunk_index,path,sha256,size FROM chunks').all();for(const row of snapshot.prepare("SELECT id,data FROM records WHERE kind='prayer-session'").all())prayerStates.set(row.id,JSON.parse(row.data));}finally{snapshot.close();}
  const files=new Set();for(const name of selectedRoots)await walk(root,join(root,name),files,signal);
  for(const chunk of chunks){
    if(!inside(root,chunk.path))throw new Error('A recorded capture path is outside private storage');
    if(!await exists(chunk.path)){
      const record=prayerStates.get(chunk.session_id);if(record?.rawDeletionEvidence?.chunks?.some(c=>c.index===chunk.chunk_index&&c.sha256===chunk.sha256)||record?.rawCleanupAuthorization?.chunks?.some(c=>c.index===chunk.chunk_index&&c.sha256===chunk.sha256))continue;
      throw new Error('A referenced capture file is missing; backup remains incomplete');
    }
    const path=await realpath(chunk.path);if(!inside(root,path)||await fileSha256(path)!==chunk.sha256||(await stat(path)).size!==chunk.size)throw new Error('A capture checksum does not match the database snapshot');files.add(path);
  }
  const entries=[{path:'lifeos.sqlite',sha256:await fileSha256(database),bytes:(await stat(database)).size,kind:'database'}];
  for(const path of [...files].sort()){
    check(signal);const rel=relative(root,path).split(sep).join('/'),destination=join(staging,'data',...rel.split('/'));await mkdir(dirname(destination),{recursive:true});
    const before=await fileSha256(path);await copyFile(path,destination,1);const after=await fileSha256(destination);
    if(before!==after||await fileSha256(path)!==after)throw new Error('A file changed during backup; the incomplete snapshot remains for review');
    entries.push({path:`data/${rel}`,sha256:after,bytes:(await stat(destination)).size,kind:'private-file'});
  }
  const manifest={schemaVersion:1,id,createdAt:new Date().toISOString(),sourceRoot:root,environment:config.environment,integrity,files:entries,excluded:['credentials','browser profiles','runtime tools and models','redundant decoded audio'],restoreMode:'new-directory-with-integrations-paused'};
  await writeFile(join(staging,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});await verifyLocalBackup(staging);check(signal);await rename(staging,directory);
  return {directory,manifest,reused:false};
}

export async function verifyLocalBackup(directory){
  const base=await realpath(directory),manifest=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length>100000||!manifest.files.some(f=>f.path==='lifeos.sqlite'))throw new Error('Invalid backup manifest');
  const seen=new Set();for(const entry of manifest.files){
    if(typeof entry.path!=='string'||entry.path.includes('\\')||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(entry.path)||! /^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Unsafe or duplicate backup manifest path');seen.add(entry.path);
    const path=join(base,...entry.path.split('/'));if(!inside(base,path)||!inside(base,await realpath(path))||(await stat(path)).size!==entry.bytes||await fileSha256(path)!==entry.sha256)throw new Error('Backup file read-back failed');
  }
  const db=new DatabaseSync(join(base,'lifeos.sqlite'),{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup database integrity failed');}finally{db.close();}
  return manifest;
}

/** Upload every immutable backup file and the manifest. Google verifies every file's full SHA-256 read-back. */
export async function archiveBackup({backup,adapter,parentId,signal,progress=()=>{}}){
  if(!parentId)throw Object.assign(new Error('Private Drive backup folder is not configured'),{code:'configuration_missing'});
  const manifest=await verifyLocalBackup(backup.directory);check(signal);
  const folder=await adapter.ensureFolder({key:`backup:${manifest.id}`,name:`LifeOS backup ${manifest.createdAt.slice(0,10)} ${manifest.id}`,parentId});
  const folderId=folder.file?.id??folder.id;if(!folderId)throw new Error('Backup folder did not return an ID');const archives=[];
  for(const entry of manifest.files){
    check(signal);progress(`Backing up private file ${archives.length+1} of ${manifest.files.length}`);
    const content=await readFile(join(backup.directory,...entry.path.split('/')));if(hash(content)!==entry.sha256)throw new Error('Local backup changed before upload');
    const result=await adapter.uploadFile({key:`backup:${manifest.id}:file:${entry.path}`,name:`${hash(entry.path).slice(0,12)}-${entry.path.split('/').at(-1)}`,content,mimeType:'application/octet-stream',parentId:folderId});
    if(!result.verified||result.sha256!==entry.sha256)throw new Error('Private backup read-back did not match');archives.push({...entry,fileId:result.file.id});
  }
  check(signal);const cloudManifest={...manifest,files:archives},text=JSON.stringify(cloudManifest,null,2);
  const result=await adapter.uploadText({key:`backup:${manifest.id}:manifest`,name:'restore-manifest.json',text,parentId:folderId});
  if(!result.verified||result.sha256!==hash(text))throw new Error('Private backup manifest read-back did not match');
  return {verified:true,folderId,manifestFileId:result.file.id,manifestSha256:result.sha256,files:archives.length,verifiedAt:new Date().toISOString()};
}

/** Reconstruct a full backup from its private Drive manifest. This never writes into an existing directory. */
export async function downloadBackup({adapter,manifestFileId,destination,signal,progress=()=>{}}){
  if(typeof adapter?.readManagedFile!=='function')throw new Error('A verified managed Drive file reader is required');
  const target=resolve(destination);if(await exists(target))throw new Error('Backup download destination must not exist');check(signal);
  const saved=await adapter.readManagedFile(manifestFileId);if(!saved.verified||saved.bytes.length>16*1024*1024||hash(saved.bytes)!==saved.sha256)throw new Error('Cloud backup manifest read-back failed');
  const manifest=JSON.parse(saved.bytes.toString('utf8')),parentId=saved.file.parents?.length===1?saved.file.parents[0]:null;
  if(!parentId||manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>100000||typeof manifest.sourceRoot!=='string'||!isAbsolute(manifest.sourceRoot))throw new Error('Cloud backup manifest is invalid');
  const seen=new Set(),fileIds=new Set();let total=0;
  for(const entry of manifest.files){
    if(typeof entry.path!=='string'||entry.path.includes('\\')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||!(entry.path==='lifeos.sqlite'||entry.path.startsWith('data/'))||seen.has(entry.path.toLowerCase())||! /^[a-f0-9]{64}$/.test(entry.sha256)||typeof entry.fileId!=='string'||!entry.fileId||fileIds.has(entry.fileId)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>256*1024*1024)throw new Error('Cloud backup contains an unsafe path, duplicate file or invalid size');
    seen.add(entry.path.toLowerCase());fileIds.add(entry.fileId);total+=entry.bytes;
  }
  if(!seen.has('lifeos.sqlite'))throw new Error('Cloud backup has no database snapshot');
  const parent=await realpath(dirname(target)),space=await statfs(parent,{bigint:true});if(BigInt(total)+64n*1024n*1024n>space.bavail*space.bsize)throw new Error('Insufficient local disk space for this verified backup download');
  await mkdir(target);await writeFile(join(target,'download-state.json'),JSON.stringify({manifestFileId,manifestSha256:saved.sha256,status:'incomplete'}),{flag:'wx'});
  let count=0;for(const entry of manifest.files){
    check(signal);progress(`Restoring private backup file ${++count} of ${manifest.files.length}`);const result=await adapter.readManagedFile(entry.fileId);
    if(!result.verified||result.file.parents?.length!==1||result.file.parents[0]!==parentId||result.bytes.length!==entry.bytes||result.sha256!==entry.sha256||hash(result.bytes)!==entry.sha256)throw new Error('Cloud backup file ownership, location or checksum did not match');
    const path=join(target,...entry.path.split('/'));if(!inside(target,path))throw new Error('Cloud backup path escaped its new directory');await mkdir(dirname(path),{recursive:true});await writeFile(path,result.bytes,{flag:'wx'});if(await fileSha256(path)!==entry.sha256)throw new Error('Downloaded backup file read-back failed');
  }
  check(signal);await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});await verifyLocalBackup(target);await writeFile(join(target,'download-state.json'),JSON.stringify({manifestFileId,manifestSha256:saved.sha256,status:'verified',verifiedAt:new Date().toISOString()}));
  return {downloaded:true,verified:true,directory:target,manifestFileId,manifestSha256:saved.sha256,files:manifest.files.length};
}

/**
 * Restore into a NEW empty directory only. Call downloadBackup first for a cloud backup, then pass its directory.
 * This verifies hashes and SQLite integrity before copying.
 * Sessions are revoked, queued work is paused and capture/artifact paths are rebased in the restored copy.
 * No credentials are restored. Configure the owner connection and review paused jobs before enabling it.
 */
export async function restoreBackup({directory,destination}){
  const manifest=await verifyLocalBackup(directory),target=resolve(destination);if(await exists(target))throw new Error('Restore destination must not exist');
  if(inside(directory,target)||inside(target,directory))throw new Error('Restore cannot overlap its source backup');await mkdir(target,{recursive:true});
  for(const entry of manifest.files){const relativePath=entry.path==='lifeos.sqlite'?'lifeos.sqlite':entry.path.replace(/^data\//,'');if(relativePath===entry.path&&entry.path!=='lifeos.sqlite')throw new Error('Unexpected backup file layout');const dest=join(target,...relativePath.split('/'));if(!inside(target,dest))throw new Error('Unsafe restore path');await mkdir(dirname(dest),{recursive:true});await copyFile(join(directory,...entry.path.split('/')),dest,1);if(await fileSha256(dest)!==entry.sha256)throw new Error('Restored file read-back failed');}
  if(typeof manifest.sourceRoot!=='string'||!isAbsolute(manifest.sourceRoot))throw new Error('Backup source root is invalid');
  const rebase=value=>typeof value==='string'&&isAbsolute(value)&&inside(manifest.sourceRoot,value)?join(target,relative(manifest.sourceRoot,value)):Array.isArray(value)?value.map(rebase):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v)])):value;
  const db=new DatabaseSync(join(target,'lifeos.sqlite'));try{
    db.exec('BEGIN IMMEDIATE');for(const row of db.prepare('SELECT kind,id,data FROM records').all())db.prepare('UPDATE records SET data=? WHERE kind=? AND id=?').run(JSON.stringify(rebase(JSON.parse(row.data))),row.kind,row.id);
    for(const row of db.prepare('SELECT session_id,chunk_index,path FROM chunks').all())db.prepare('UPDATE chunks SET path=? WHERE session_id=? AND chunk_index=?').run(rebase(row.path),row.session_id,row.chunk_index);
    db.exec("UPDATE sessions SET revoked=1; UPDATE jobs SET status='needs-input',lease_owner=NULL,lease_until=NULL,error='Restored backup: review before resuming' WHERE status IN ('running','queued');");
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='presence_devices'").get())db.exec('UPDATE presence_devices SET revoked=1');
    db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('automationPaused','true');db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('restoreEvidence',JSON.stringify({backupId:manifest.id,restoredAt:new Date().toISOString(),integrationsEnabled:false}));db.exec('COMMIT');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Restored database integrity failed');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
  return {restored:true,destination:target,integrity:'ok',files:manifest.files.length,automationPaused:true,credentialsRestored:false};
}
