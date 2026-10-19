import {PRAYER_IDS,PRAYER_TITLES,validatePrayerList} from './prayer-tree.js';
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function prayerListText(sections){return sections.map((s,i)=>{let shownDay;const lines=[PRAYER_TITLES[i]],walk=(nodes,day)=>{for(const n of nodes){const next=n.weekday??day;if(next!=null&&next!==shownDay){lines.push(DAYS[next]+':');shownDay=next;}const structuralDay=next!=null&&n.type==='group'&&n.text?.trim().replace(/:$/,'').toLowerCase()===DAYS[next].toLowerCase();if(n.text?.trim()&&!structuralDay)lines.push((n.type==='guidance'?'/ ':n.type==='request'?'- ':'')+n.text);walk(n.children??[],next);}};walk(s.nodes);return lines.join('\n');}).join('\n\n');}
export function parsePrayerText(text,previous,makeId=()=>crypto.randomUUID()){
 if(typeof text!=='string'||text.length>500000)throw Error('Prayer text exceeds the supported size. Your draft is preserved.');
 if(text.trim()===prayerListText(previous??[]).trim())return validatePrayerList(structuredClone(previous));
 const sections=PRAYER_IDS.map((id,i)=>({id,title:PRAYER_TITLES[i],nodes:[]})),old=[];
 function flatten(nodes,day,section){for(const n of nodes){old.push({n,weekday:n.weekday??day,section});flatten(n.children??[],n.weekday??day,section);}}for(const [i,s] of (previous??[]).entries())flatten(s.nodes??[],undefined,i);
 const used=new Set();let section=0,weekday,parent=null;
 const lines=text.split(/\r?\n/);for(let li=0;li<lines.length;li++){const raw=lines[li];
  let line=raw.trim();if(!line)continue;
  const header=line.replace(/^#\s*/,'').replace(/:$/,'');const si=PRAYER_TITLES.findIndex(t=>t.toLowerCase()===header.toLowerCase());
  if(si>=0){section=si;weekday=undefined;parent=null;continue;}
  const dm=line.match(/^\[?(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\]?:?(?:\s|$)/i);
  if(dm){weekday=DAYS.findIndex(d=>d.toLowerCase()===dm[1].toLowerCase());line=line.slice(dm[0].length).trim();parent=null;if(!line)continue;}
  const guidance=line.startsWith('/ ')&&!/^\/\s+(?:\/\s+)*-\s/.test(line);
  line=line.replace(/^(?:\/\s+)+/,'');const bullet=/^[-•]\s/.test(line);line=line.replace(/^[-•]\s+/,'').replace(/^\|\s/,'');if(line==='[ ]'||!line)continue;
  const multiline=old.find(o=>o.section===section&&o.weekday===weekday&&o.n.text.includes('\n')&&o.n.text.split('\n')[0]===line&&o.n.text.split('\n').slice(1).every((part,j)=>lines[li+j+1]?.replace(/^\|\s/,'')===part));if(multiline){li+=multiline.n.text.split('\n').length-1;line=multiline.n.text;}
  const at=old.findIndex((o,k)=>!used.has(k)&&o.n.text===line&&o.weekday===weekday&&o.section===section);let before=at>=0?old[at].n:null;if(at>=0)used.add(at);
  const n={...(before??{}),id:before?.id??makeId(),text:line,type:guidance?'guidance':bullet?'request':before?.type??'group',children:[]};delete n.runs;delete n.blockStyle;delete n.weekday;if(weekday!=null)n.weekday=weekday;
  if(bullet&&parent)parent.children.push(n);else sections[section].nodes.push(n);if(!bullet&&!guidance)parent=n;
 }
 return validatePrayerList(sections);
}
