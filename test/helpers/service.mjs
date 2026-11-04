import {createService as createStandaloneService} from '../../src/local/service.ts';
import {openTestDatabase} from './database.mjs';
/** Existing API tests use real PostgreSQL with a fresh schema per service fixture. */
export async function createService(options={}){
 if(!process.env.TEST_DATABASE_URL||options.database!==':memory:')return createStandaloneService(options);
 const storage=await openTestDatabase('postgres');
 try{return await createStandaloneService({...options,storage});}catch(error){await storage.close();throw error;}
}
