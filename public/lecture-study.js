const types=['bookmark','glossary','review','index','practice','recall','deck'];
const keys=['type','label','pageId','strokeId','offsetMs','sourceId','sourcePage','term','definition','explanationId','stage','dueDay','resolved','text','uncertain','inkHead','question','answer','hint','evidence','signatures','range','archived','region','previousSourceId','attempt','recall'];
export function validateStudyItem(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k))||!types.includes(input.type))throw Error('Invalid study item');
 const out=structuredClone(input);
 for(const k of ['label','term'])if(out[k]!==undefined&&(typeof out[k]!=='string'||out[k].length>200))throw Error('Keep the label under 200 characters');
 for(const k of ['definition','text','question','answer','hint','evidence','attempt'])if(out[k]!==undefined&&(typeof out[k]!=='string'||out[k].length>12000))throw Error('Study text exceeds its limit');
 for(const k of ['strokeId','sourceId','explanationId','previousSourceId'])if(out[k]!==undefined&&out[k]!==null&&!/^[-\w]{1,100}$/.test(out[k]))throw Error('Invalid study reference');
 if(out.pageId!==undefined&&!/^\d{4}$/.test(out.pageId))throw Error('Invalid note page');
 for(const [k,max]of [['offsetMs',43200000],['sourcePage',2000],['stage',8],['recall',3],['inkHead',10000]])if(out[k]!==undefined&&(!Number.isFinite(out[k])||out[k]<0||out[k]>max))throw Error('Invalid study timing or revision');
 for(const k of ['uncertain','resolved','archived'])if(out[k]!==undefined&&typeof out[k]!=='boolean')throw Error('Invalid study state');
 if(out.dueDay!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(out.dueDay))throw Error('Invalid review date');
 if(out.signatures!==undefined&&(!Array.isArray(out.signatures)||out.signatures.length>2000||out.signatures.some(s=>!/^[a-f0-9]{64}$/.test(s))))throw Error('Invalid deck signatures');
 if(out.range!==undefined&&(!out.range||!Number.isInteger(out.range.from)||!Number.isInteger(out.range.through)||out.range.from<1||out.range.through<out.range.from||out.range.through>2000))throw Error('Invalid slide range');
 if(out.region!==undefined&&out.region!==null&&(!Array.isArray(out.region)||out.region.length!==4||out.region.some(n=>!Number.isFinite(n)||n<0||n>1000000)))throw Error('Invalid note region');
 return out;
}
export function mergeStudyMarks(before=[],strokes=[]){
 const map=new Map(before.map(m=>[m.id,m]));
 for(const s of strokes){if(s.hidden||!['unclear','unfinished'].includes(s.intent)){map.delete(s.id);continue;}const regions=s.highlightRegions?.length?s.highlightRegions:s.points?.length?[{left:Math.min(...s.points.map(p=>p.x)),top:Math.min(...s.points.map(p=>p.y)),right:Math.max(...s.points.map(p=>p.x)),bottom:Math.max(...s.points.map(p=>p.y))}]:[];
  map.set(s.id,{id:s.id,pageId:s.pageId,intent:s.intent,offsetMs:s.startedAtOffsetMs,regions:regions.slice(0,20)});
 }return [...map.values()].slice(-500);
}
export function nextReviewDay(day,stage=0){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+[1,3,7,14,30,60,90,120,180][Math.min(8,stage)]);if(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
export function compareDecks(before,after){if(!before?.length)return {kind:'baseline',range:null};if(before.length===after.length&&before.every((s,i)=>s===after[i]))return {kind:'unchanged',range:null};if(after.length>before.length&&before.every((s,i)=>s===after[i]))return {kind:'appended',range:{from:before.length+1,through:after.length}};return {kind:'changed',range:null};}
const normal=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[αβγδθλμσπω]/g,c=>({α:'alpha',β:'beta',γ:'gamma',δ:'delta',θ:'theta',λ:'lambda',μ:'mu',σ:'sigma',π:'pi',ω:'omega'})[c]).replace(/[×·]/g,'*').replace(/[−–]/g,'-').replace(/\\(?:cdot|times)/g,'*').replace(/\\|\s|[{}]/g,'');
export function searchStudy(items,query){const needle=normal(query);return needle?items.filter(r=>!r.data.archived&&normal([r.data.term,r.data.definition,r.data.text,r.data.label].filter(Boolean).join(' ')).includes(needle)):[];}
