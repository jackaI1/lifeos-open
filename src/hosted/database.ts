/** D1-shaped adapter for one visitor's SQLite Durable Object. No external database binding. */
export class HostedStatement {
 db:HostedDatabase;query:string;args:any[];
 constructor(db:HostedDatabase,query:string,args:any[]=[]){this.db=db;this.query=query;this.args=args;}
 bind(...args:any[]){return new HostedStatement(this.db,this.query,args.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):ArrayBuffer.isView(v)?v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength):v));}
 execute(){const cursor=this.db.storage.sql.exec(this.query,...this.args);return {results:cursor.toArray(),success:true,meta:{changes:cursor.rowsWritten,rows_read:cursor.rowsRead,rows_written:cursor.rowsWritten,duration:0}};}
 async all(){return this.db.atomic(()=>this.execute());}
 async first(column?:string){const row=(await this.all()).results[0];return column?row?.[column]??null:row??null;}
 async run(){return this.all();}
 async raw(){return (await this.all()).results.map((r:any)=>Object.values(r));}
}
export class HostedDatabase {
 maxBytes:number;
 storage:any;
 constructor(storage:any,{maxBytes=20*1024*1024}={}){this.storage=storage;this.maxBytes=maxBytes;}
 prepare(query:string){return new HostedStatement(this,query);}
 atomic<T>(fn:()=>T):T{return this.storage.transactionSync(()=>{const result=fn();if(this.storage.sql.databaseSize>this.maxBytes)throw new Error('Demo storage limit reached. Export or reset this demo.');return result;});}
 exec(query:string){return this.atomic(()=>this.storage.sql.exec(query).toArray());}
 async batch(statements:HostedStatement[]){return this.atomic(()=>statements.map(s=>s.execute()));}
 close(){}
}
