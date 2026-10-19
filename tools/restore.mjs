import {restoreBackupFile} from '../src/local/backup.ts';
const [source,destination]=process.argv.slice(2);
if(!source||!destination){console.error('Usage: npm run restore -- backup.json NEW_DATABASE.sqlite');process.exitCode=1;}
else{await restoreBackupFile(source,destination);console.log('Backup verified and restored to a new database. Start LifeOS with LIFEOS_DATABASE set to that path. Existing databases are never overwritten.');}
