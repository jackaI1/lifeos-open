// Optional local text-model boundary. No AI, Spark, API keys or remote provider fallback.
export const PRAYER_REPAIR_INSTRUCTION="Correct likely speech-recognition errors using linguistic context and the provided prayer-list context. Preserve meaning. Do not invent requests, events, confessions, names or statements merely because they appear in the prayer list. When evidence remains ambiguous, retain uncertainty.";
export async function repairPrayerTranscript({rawTranscript,provider=null,context={}}){
 const normalized=rawTranscript.replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();
 if(!provider)return {text:normalized,method:'deterministic-normalization',model:null};
 // A future adapter must explicitly implement this interface and validate its output.
 if(provider.transport!=='loopback'||typeof provider.repair!=='function')throw Error('Only an explicitly configured local repair provider is allowed');
 const result=await provider.repair({instruction:PRAYER_REPAIR_INSTRUCTION,text:normalized,context});
 if(typeof result?.text!=='string'||result.text.length>200000)throw Error('Invalid local repair result');return{...result,method:'local-contextual-repair'};
}
