import {AppError} from '../shared/errors.mjs';
// Drive version includes metadata-only changes. Docs revision protects the verified native document.
export async function verifyBackupRevision({backup,cachedRevision,readDrive,readDocumentRevision}){
 const current=await readDrive();if(String(current.version)===String(backup.verifiedDriveVersion))return null;
 const expected=backup.verifiedDocumentRevision??cachedRevision;if(!expected)throw new AppError('The recovery backup needs content verification. Your writing is safe.',409,'backup_conflict');
 const document=await readDocumentRevision();if(document.revisionId!==expected)throw new AppError('The recovery backup content changed. Preserve it for review. Your writing is safe.',409,'backup_conflict');
 return {verifiedDriveVersion:String(current.version),verifiedDocumentRevision:expected};
}
