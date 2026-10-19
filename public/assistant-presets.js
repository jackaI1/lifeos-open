export let ASSISTANT_PRESETS=[{model:'demo-ai',effort:'high',label:'Demo AI (offline)'}];
export let DEFAULT_ASSISTANT_PRESET=ASSISTANT_PRESETS[0];
export function configureAssistantPresets(items){if(Array.isArray(items)&&items.length){ASSISTANT_PRESETS=items;DEFAULT_ASSISTANT_PRESET=items[0];}}
export function assistantPreset(model=DEFAULT_ASSISTANT_PRESET.model,effort=DEFAULT_ASSISTANT_PRESET.effort){return typeof model==='string'&&model.length<=160&&/^[\w./:@+-]+$/.test(model)&&['low','medium','high','xhigh'].includes(effort)?{model,effort,label:model==='demo-ai'?'Demo AI (offline)':model}:null;}
export function effectiveAssistantPreset(model,effort){return assistantPreset(model,effort)??DEFAULT_ASSISTANT_PRESET;}
