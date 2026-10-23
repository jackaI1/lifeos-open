import {DurableObject} from 'cloudflare:workers';
export class DemoAdmission extends DurableObject {
 async check(newVisitor:boolean){
  const day=new Date().toISOString().slice(0,10);
  return this.ctx.storage.transactionSync(()=>{
   const sql=this.ctx.storage.sql;sql.exec('CREATE TABLE IF NOT EXISTS admission(day TEXT PRIMARY KEY,requests INTEGER,new_visitors INTEGER)');
   const row=sql.exec('SELECT * FROM admission WHERE day=?',day).toArray()[0]??{requests:0,new_visitors:0};
   if(row.requests>=10000||newVisitor&&row.new_visitors>=25)return false;
   sql.exec('INSERT INTO admission VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET requests=excluded.requests,new_visitors=excluded.new_visitors',day,row.requests+1,row.new_visitors+Number(newVisitor));
   sql.exec('DELETE FROM admission WHERE day<?',day);return true;
  });
 }
}
