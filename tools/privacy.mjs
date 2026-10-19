import {readdir,readFile,lstat} from 'node:fs/promises';import {join,relative} from 'node:path';
const all=process.argv.includes('--all');
const rules=[
 ['absolute home path',/[\/]Users[\/][^\s"'`]+/g],
 ['credential',/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g],
 ['OAuth client resource',/\b\d{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com\b/g],
 ['phone',/(?:\+1[ .-]\d{3}[ .-]\d{3}[ .-]\d{4}|\(\d{3}\) \d{3}-\d{4})/g],
 ['email',/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g]
];
// Owner-specific patterns belong in an operator-owned file outside this repository.
if(process.env.LIFEOS_PRIVACY_PATTERNS){
 const configured=JSON.parse(await readFile(process.env.LIFEOS_PRIVACY_PATTERNS,'utf8'));
 if(!Array.isArray(configured))throw Error('External privacy patterns must be an array.');
 for(const item of configured){if(typeof item.pattern!=='string'||item.pattern.length>2000)throw Error('Invalid external privacy pattern.');rules.push(['operator-supplied privacy pattern',new RegExp(item.pattern,item.flags??'ig')]);}
}
let files=0,bytes=0;const findings=[],attribution=[],symlinks=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),rel=relative('.',path);if(entry.name==='.git'||!all&&entry.name==='node_modules')continue;if(entry.isSymbolicLink()){symlinks.push(rel);continue;}if(entry.isDirectory()){if(!all&&(entry.name.startsWith('.lifeos')||['node_modules','.runtime','.local','.cache','.wrangler','build','dist','coverage','data','uploads','backups','recordings','transcripts','exports','playwright-report','test-results'].includes(entry.name)))continue;await walk(path);continue;}if(!entry.isFile())continue;const size=(await lstat(path)).size;files++;bytes+=size;if(size>8_000_000)continue;const data=await readFile(path),text=data.toString('utf8');for(const [type,pattern] of rules){pattern.lastIndex=0;for(const match of text.matchAll(pattern)){if(type==='email'&&/@example\.(?:invalid|test|com|org)$/.test(match[0]))continue;const row={file:rel,line:text.slice(0,match.index).split('\n').length,type};if(rel.startsWith('public/vendor/')&&type==='email'){attribution.push(row);continue;}findings.push(row);}}}}
await walk('.');
console.log(JSON.stringify({scope:all?'entire output tree':'publishable source; excludes generated dependencies, build, runtime and git metadata',files,bytes,findings,thirdPartyAttributionCandidates:attribution,symlinks:symlinks.filter(p=>!p.startsWith('node_modules/'))},null,2));
if(findings.length)process.exitCode=1;
