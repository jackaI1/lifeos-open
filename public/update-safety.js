export function updateBlockReason({dirty=false,pending=0,editing=false}={}){return dirty?'Finish or leave the active writing or recording first.':pending?'Sync or recover unsent work before updating.':editing?'Finish typing before updating.':null;}
export function editingElement(element){return !!element&&(element.isContentEditable||['INPUT','TEXTAREA'].includes(element.tagName));}
