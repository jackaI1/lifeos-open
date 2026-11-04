import {PostgresDatabase} from '../src/storage/postgres.ts';
import {transferSqlite} from '../src/storage/transfer.ts';
const path=process.argv[2];
if(!path||!process.env.DATABASE_URL){console.error('Usage: DATABASE_URL=<connection URL> npm run db:import -- <SQLite file>');process.exitCode=1;}
else {
 const db=new PostgresDatabase(process.env.DATABASE_URL);
 try{const result=await transferSqlite(path,db);console.log(JSON.stringify({verified:true,...result}));}
 catch{console.error('Transfer failed; no imported data committed. Check source integrity, destination emptiness and database access.');process.exitCode=1;}
 finally{await db.close();}
}
