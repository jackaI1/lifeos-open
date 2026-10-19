import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
export type Row=Record<string,any>;
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
 db:DatabaseSync;
 constructor(path:string){this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');if(path!==':memory:')this.db.exec('PRAGMA journal_mode=WAL;');}
 prepare(query:string){return new LocalStatement(this.db,query);}
 exec(sql:string){this.db.exec(sql);}
 async batch(statements:LocalStatement[]){this.db.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
}
