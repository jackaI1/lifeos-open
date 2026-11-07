/** Fail every medium/high passive finding except an exact, reviewed baseline. */
import {readFile} from 'node:fs/promises';
const report=JSON.parse(await readFile(process.argv[2],'utf8'));
const known=JSON.parse(await readFile(new URL('./zap-baseline.json',import.meta.url),'utf8'));
const failures=[];
if(!Array.isArray(report.site)||!report.site.length)throw Error('Missing ZAP sites');
for(const site of report.site)for(const alert of site.alerts??[]){
 const risk=Number(alert.riskcode);if(!Number.isInteger(risk)||risk<0||risk>3)throw Error('Invalid ZAP risk');
 if(risk<2)continue;
 for(const instance of alert.instances?.length?alert.instances:[{}]){
  if(!known.some(item=>alert.alertRef===item.alertRef&&(instance.evidence??'')===item.evidence&&item.paths.includes(new URL(instance.uri).pathname)))failures.push({rule:alert.alertRef,name:alert.name,evidence:(instance.evidence??'').slice(0,300)});
 }
}
console.log(JSON.stringify({new_medium_or_high:failures},null,2));
if(failures.length)process.exitCode=1;
