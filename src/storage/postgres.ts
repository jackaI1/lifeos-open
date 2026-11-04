import pg from 'pg';
import {loadMigrations} from './migrations.ts';
import {postgresSQL} from './sql.mjs';
import type {WorkspaceDatabase,WorkspaceStatement,Row} from './types.ts';
import type {PoolClient,PoolConfig,QueryResult} from 'pg';
const types={getTypeParser(oid:number,format?:any){if(oid===20||oid===1700)return (value:string)=>{const n=Number(value);if(!Number.isFinite(n)||Number.isInteger(n)&&!Number.isSafeInteger(n))throw Error('Database number exceeds JavaScript precision.');return n;};return pg.types.getTypeParser(oid,format);}};
function result(r:QueryResult){return {results:r.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='boolean'?Number(value):value]))),success:true,meta:{changes:['INSERT','UPDATE','DELETE'].includes(r.command)?r.rowCount??0:0,rows_read:r.rows.length,rows_written:['INSERT','UPDATE','DELETE'].includes(r.command)?r.rowCount??0:0,duration:0}};}
class PostgresStatement implements WorkspaceStatement {
 owner:PostgresDatabase;query:string;args:any[];
 constructor(owner:PostgresDatabase,query:string,args:any[]=[]){this.owner=owner;this.query=query;this.args=args;}
 bind(...args:any[]){return new PostgresStatement(this.owner,this.query,args.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):v instanceof Uint8Array?Buffer.from(v):v));}
 async all(){return this.owner.execute(this.query,this.args);}
 async first(column?:string){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;}
 async run(){return this.all();}
 async raw(){return (await this.all()).results.map(row=>Object.values(row));}
}
/** One bounded pool per service; every transaction owns one checked-out client. */
export class PostgresDatabase implements WorkspaceDatabase {
 readonly dialect='postgres';pool:pg.Pool;client?:PoolClient;ownsPool:boolean;closed=false;
 constructor(config:PoolConfig|string,client?:PoolClient,pool?:pg.Pool){
  this.pool=pool??new pg.Pool({max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,statement_timeout:30000,...typeof config==='string'?{connectionString:config}:config,types});
  this.client=client;this.ownsPool=!pool;
  if(this.ownsPool)this.pool.on('error',()=>{console.error('An idle PostgreSQL connection closed; the pool will reconnect.');});
 }
 prepare(query:string){return new PostgresStatement(this,query);}
 async execute(query:string,args:any[]=[]){
  try{return result(await (this.client??this.pool).query(postgresSQL(query,args),args));}
  catch(error:any){if(['23505','23514','40001','40P01'].includes(error.code))throw new Error((error.code==='23505'?'UNIQUE constraint':'CHECK constraint')+' failed; transaction rejected.');throw error;}
 }
 async exec(sql:string){await (this.client??this.pool).query(postgresSQL(sql));}
 async transaction<T>(fn:(db:PostgresDatabase)=>Promise<T>):Promise<T>{
  if(this.client)throw Error('Nested transactions are not supported.');
  const client=await this.pool.connect();
  try{await client.query('BEGIN');const value=await fn(new PostgresDatabase({},client,this.pool));await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
 }
 async batch(statements:PostgresStatement[]){
  if(statements.some(s=>s.owner!==this))throw Error('Batch statements must belong to this database.');
  const run=async(tx:PostgresDatabase)=>{const rows=[];for(const s of statements)rows.push(await tx.execute(s.query,s.args));return rows;};
  return this.client?run(this):this.transaction(run);
 }
 async migrate(){
  const migrations=await loadMigrations('postgres');
  await this.transaction(async tx=>{
   await tx.client!.query('SELECT pg_advisory_xact_lock(182736451)');
   await tx.client!.query('CREATE TABLE IF NOT EXISTS _workspace_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
   for(const {version,sql} of migrations)if(!await tx.prepare('SELECT version FROM _workspace_migrations WHERE version=?').bind(version).first()){
    await tx.client!.query(sql);
    await tx.prepare('INSERT INTO _workspace_migrations VALUES(?,?)').bind(version,new Date().toISOString()).run();
   }
  });
 }
 async tableNames(){return (await (this.client??this.pool).query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name")).rows.map((r:Row)=>String(r.name));}
 async close(){if(this.ownsPool&&!this.closed){this.closed=true;await this.pool.end();}}
}
