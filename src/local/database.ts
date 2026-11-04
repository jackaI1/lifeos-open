import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {loadMigrations} from '../storage/migrations.ts';
import type {Row,WorkspaceDatabase} from '../storage/types.ts';
export type {Row,WorkspaceStatement,WorkspaceDatabase} from '../storage/types.ts';

export class LocalStatement {
 db:DatabaseSync; query:string; args:SQLInputValue[];
 constructor(db:DatabaseSync,query:string,args:SQLInputValue[]=[]){this.db=db;this.query=query;this.args=args;}
 bind(...args:any[]){return new LocalStatement(this.db,this.query,args.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):v));}
 async all(){const results=this.db.prepare(this.query).all(...this.args) as Row[];return {results,success:true,meta:{changes:0,rows_read:results.length,rows_written:0,duration:0}};}
 async first(column?:string){const row=this.db.prepare(this.query).get(...this.args) as Row|undefined;return column?row?.[column]??null:row??null;}
 async run(){const info=this.db.prepare(this.query).run(...this.args);return {success:true,results:[],meta:{changes:Number(info.changes),last_row_id:Number(info.lastInsertRowid),rows_written:Number(info.changes),rows_read:0,duration:0}};}
 async raw(){const statement=this.db.prepare(this.query);statement.setReturnArrays(true);return statement.all(...this.args);}
 execute(){const statement=this.db.prepare(this.query);const results=statement.all(...this.args) as Row[];return {results,success:true,meta:{changes:0,rows_read:results.length,rows_written:0,duration:0}};}
}
/** D1's validated SQL routes run unchanged, with real atomic local SQLite batches. */
export class LocalDatabase {
 readonly dialect='sqlite';
 db:DatabaseSync;
 constructor(path:string,{readOnly=false}={}){this.db=new DatabaseSync(path,{readOnly});this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');if(!readOnly&&path!==':memory:')this.db.exec('PRAGMA journal_mode=WAL;');}
 prepare(query:string){return new LocalStatement(this.db,query);}
 exec(sql:string){this.db.exec(sql);}
 async batch(statements:LocalStatement[]){this.db.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 async migrate(){
  const migrations=await loadMigrations('sqlite');
  await this.transaction(async db=>{
   await db.exec('CREATE TABLE IF NOT EXISTS _workspace_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
   for(const {version,sql} of migrations)if(!await db.prepare('SELECT version FROM _workspace_migrations WHERE version=?').bind(version).first()){
    await db.exec(sql);await db.prepare('INSERT INTO _workspace_migrations VALUES(?,?)').bind(version,new Date().toISOString()).run();
   }
  });
 }
 async transaction<T>(fn:(db:WorkspaceDatabase)=>Promise<T>):Promise<T>{this.db.exec('BEGIN IMMEDIATE');try{const result=await fn(this);this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
}
