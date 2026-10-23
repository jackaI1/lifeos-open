/** The D1-compatible adapter used by the unchanged application routes. */
export class BrowserDatabase {
 constructor(SQL,bytes){this.db=bytes?new SQL.Database(new Uint8Array(bytes)):new SQL.Database();this.closed=false;this.db.run('PRAGMA foreign_keys=ON');}
 prepare(query){return new BrowserStatement(this,query);}
 exec(sql){return this.db.exec(sql);}
 export(){return this.db.export();}
 async batch(statements){this.db.run('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());this.db.run('COMMIT');return result;}catch(error){this.db.run('ROLLBACK');throw error;}}
 close(){if(!this.closed){this.db.close();this.closed=true;}}
}
class BrowserStatement {
 constructor(owner,query,args=[]){this.owner=owner;this.query=query;this.args=args;}
 bind(...args){return new BrowserStatement(this.owner,this.query,args.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):v));}
 execute(arrays=false){const db=this.owner.db,statement=db.prepare(this.query);try{statement.bind(this.args);const results=[];while(statement.step())results.push(arrays?statement.get():statement.getAsObject());return {results,success:true,meta:{changes:db.getRowsModified(),rows_read:results.length,rows_written:db.getRowsModified(),duration:0}};}finally{statement.free();}}
 async all(){return this.execute();}
 async first(column){const value=this.execute().results[0]??null;return column?value?.[column]??null:value;}
 async run(){return this.execute();}
 async raw(){return this.execute(true).results;}
}
