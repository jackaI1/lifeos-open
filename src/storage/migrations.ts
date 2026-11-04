import {readdir,readFile} from 'node:fs/promises';
/** Append numbered files for upgrades; applied versions are never rerun. */
export async function loadMigrations(dialect:'sqlite'|'postgres'){
 const directory='src/storage/migrations/'+dialect;
 const files=(await readdir(directory)).filter(name=>/^\d{4}-[a-z0-9-]+\.sql$/.test(name)).sort();
 const versions=new Set<number>();
 return Promise.all(files.map(async name=>{
  const version=Number(name.slice(0,4));if(versions.has(version))throw Error('Duplicate storage migration version.');versions.add(version);
  return {version,sql:await readFile(directory+'/'+name,'utf8')};
 }));
}
