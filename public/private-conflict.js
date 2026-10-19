// Called only after the owner chooses a version. Preserve the other version first.
export async function resolvePrivateConflict(draft,server,choice){
 if(!['device','server'].includes(choice)||!server?.data||!Number.isInteger(server.version))throw Error('Choose a valid version');
 await draft.saving?.catch(()=>{});await draft.persistence;
 const backup={savedAt:new Date().toISOString(),server:structuredClone(server),device:structuredClone(draft.value)};
 if(!await draft.store.put('conflict:'+draft.key+':'+crypto.randomUUID(),backup))throw Error('Download both versions before replacing either. This device cannot preserve a recovery copy.');
 draft.value={...draft.value,data:choice==='server'?structuredClone(server.data):draft.value.data,version:server.version,pending:null,dirty:choice==='device',updatedAt:server.updatedAt};draft.error=null;await draft.persist();draft.changed(draft);
}
