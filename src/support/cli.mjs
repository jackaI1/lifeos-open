import {openSupport} from './assistant.mjs';

let session;
try{
 const ticket=process.argv.slice(2).join(' ');
 if(!ticket.trim())throw Error('Usage: npm run support -- "My saved-text retrieval is unavailable"');
 session=await openSupport();
 console.log(JSON.stringify(await session.assistant.ask(ticket),null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await session?.close();}
