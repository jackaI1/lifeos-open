// Confirmation belongs to owner controls, not background save/recovery work.
export async function confirmLectureFinish({finished=false,finish,reopen,ask=message=>globalThis.confirm(message)}){
 const message=finished?'Unfinish this lecture? Your notes will reopen. Recording will stay stopped.':'Finish this lecture? Recording will stop and your notes and audio will be saved.';
 if(!ask(message))return false;
 await (finished?reopen():finish());return true;
}
