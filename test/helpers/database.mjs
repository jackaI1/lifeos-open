import {randomUUID} from 'node:crypto';
import {LocalDatabase} from '../../src/local/database.ts';
export async function openTestDatabase(backend='sqlite'){
 if(backend==='sqlite')return new LocalDatabase(':memory:');
 const {PostgresDatabase}=await import('../../src/storage/postgres.ts');
 const schema='test_'+randomUUID().replaceAll('-','');
 const admin=new PostgresDatabase(process.env.TEST_DATABASE_URL);
 await admin.exec('CREATE SCHEMA '+schema);
 const db=new PostgresDatabase({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,max:2});
 const close=db.close.bind(db);let closed=false;
 db.close=async()=>{if(closed)return;closed=true;try{await close();await admin.exec('DROP SCHEMA '+schema+' CASCADE');}finally{await admin.close();}};
 return db;
}
