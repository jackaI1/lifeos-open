// Recording status uses durable save receipts; completion remains an explicit action.
export function recordingStatus({local,pending=[],record}={}){
 const data=record?.data??record,saved=data?.uploadStatus==='stored'||local?.state==='uploaded';
 const error=pending.find(item=>item.error)?.error||local?.lastError||null;
 const label=saved?'Recording saved':error?'Upload not complete. Retry available.':local?.state==='recording'?'Captured audio can be recovered from this browser':pending.length?'Captured on this device. Upload pending.':local?'Finalization not confirmed. Retry available.':'No saved recording found';
 return {label,saved,captured:Boolean(local?.chunks>0),localCopy:pending.length?`${pending.length} audio chunks retained in this browser`:local?'No unsent audio chunks in this browser.':'This browser cannot inspect recordings on another device.',error};
}
