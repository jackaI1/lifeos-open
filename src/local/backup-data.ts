import type {WorkspaceDatabase} from './database.ts';
type Cell=string|number|null|{lifeosBlob:string};
export interface WorkspaceBackup {format:'lifeos-local-backup-v1';createdAt:string;tables:Record<string,Record<string,Cell>[]>}
const excluded=new Set(['sessions','oauth_logins','worker_credentials','local_snapshots']);
const identifier=(v:string)=>{if(!/^[a-z_][a-z_0-9]*$/.test(v))throw Error('Invalid backup table or column.');return '"'+v+'"';};
const encode=(value:any):Cell=>value instanceof Uint8Array?{lifeosBlob:Buffer.from(value).toString('base64')}:typeof value==='bigint'?Number(value):value;
const decode=(value:Cell)=>{if(value&&typeof value==='object'){if(Object.keys(value).length!==1||typeof value.lifeosBlob!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.lifeosBlob))throw Error('Invalid backup binary field.');return Buffer.from(value.lifeosBlob,'base64');}if(value!==null&&!['string','number'].includes(typeof value))throw Error('Invalid backup field.');return value;};
export async function tableNames(db:WorkspaceDatabase){return (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map(r=>String(r.name)).filter(n=>!n.startsWith('_')&&!excluded.has(n));}
export async function createBackup(db:WorkspaceDatabase):Promise<WorkspaceBackup>{
 const tables:WorkspaceBackup['tables']={};for(const name of await tableNames(db)){const rows=(await db.prepare('SELECT * FROM '+identifier(name)).all()).results;tables[name]=rows.filter(row=>name!=='meta'||!['local-backup','local-backup-last'].includes(row.key)).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,encode(value)])));}
 return {format:'lifeos-local-backup-v1',createdAt:new Date().toISOString(),tables};
}
