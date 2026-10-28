const data=r=>r?.data??r??{};
// A completed collector process is not proof that every assessment source was read.
export function academicCoverageIssues({courses=[],integrations=[],now=Date.now()}={}){
 const issues=[],learn=integrations.find(r=>r.id==='learn'),d=data(learn),at=Date.parse(d.lastCollectionAt??'');
 if(learn&&(d.status==='blocked'||d.coverage==='blocked'))issues.push({id:'learn-blocked',title:'Course deadlines could not be checked',reason:Date.parse(d.manualLoginRestoredAt??'')>Date.parse(d.lastAttempt??'')?'LEARN sign-in was restored, but the automatic source check has not completed yet.':d.reason||'LEARN needs sign-in. Saved tasks may be incomplete.',url:'https://learn.example.invalid/d2l/home'});
 else if(learn&&(!Number.isFinite(at)||Number(now)-at>36*3600000))issues.push({id:'learn-stale',title:'Course deadline checks are out of date',reason:'New or changed assignments may be missing. Refresh course sources.',url:'https://learn.example.invalid/d2l/home'});
 for(const course of courses)for(const source of data(course).assessmentSources??[]){
  if(source.kind==='deadline-conflict'&&source.status==='resolved'&&source.resolution?.evidenceUrls?.length)continue;
  const checked=Date.parse(source.lastVerifiedAt??'');
  if(source.status==='verified'&&Number.isFinite(checked)&&Number(now)-checked<=36*3600000)continue;
  issues.push({id:'assessment:'+course.id+':'+source.url,courseId:course.id,title:(data(course).code||data(course).title)+', '+(source.kind==='deadline-conflict'?'Conflicting deadlines':source.title+' deadlines unverified'),reason:source.reason||'This separate assignment source has not been checked. Its work may be missing from the task list.',url:source.url});
 }
 return issues;
}
export function mergeAssessmentSources(existing=[],incoming=[]){const map=new Map(existing.map(s=>[s.url,s]));for(const s of incoming){const old=map.get(s.url);if(!old)map.set(s.url,s);else if(old.kind==='deadline-conflict'&&old.status==='resolved'&&s.reason&&s.reason!==old.resolution?.conflictReason&&Date.parse(s.discoveredAt)>Date.parse(old.resolution?.resolvedAt))map.set(s.url,{...s,previousResolution:old.resolution});}return [...map.values()].slice(0,30);}
export function discoveredAssessmentSources(links=[],at){return links.filter(l=>/\b(?:pearson|mastering|m[oö]bius|crowdmark|webassign|webwork|pebblepad|perusall|astelle)\b/i.test(l.title??'')).filter(l=>{try{const u=new URL(l.url);return u.protocol==='https:'&&u.hostname==='learn.example.invalid'&&(/\/viewContent\/|\/lti\//.test(u.pathname)||u.pathname==='/d2l/common/dialogs/quickLink/quickLink.d2l'&&u.searchParams.get('type')==='lti');}catch{return false;}}).map(l=>({title:l.title,url:l.url,status:'unverified',discoveredAt:at,lastVerifiedAt:null}));}
