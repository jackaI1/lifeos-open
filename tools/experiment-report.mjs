import {readFile} from 'node:fs/promises';
import {analyze, EXPERIMENT} from '../src/analytics/experiments/analysis.ts';
// No file means clearly labelled synthetic examples, never traffic estimates.
const file=process.argv[2];
if(file){
 try{console.log(JSON.stringify(analyze(JSON.parse(await readFile(file,'utf8'))),null,2));}
 catch(error){console.error(`Cannot analyze experiment: ${error.message}`);process.exitCode=1;}
}else{
 console.log('SYNTHETIC EXAMPLES ONLY. These are not LifeOS visitor results.');
 for(const [name,n,x0,x1] of [['small',20,1,19],['planned-size',1200,240,300]]){
  const result=analyze({experiment:EXPERIMENT,control:{exposures:n,conversions:x0},treatment:{exposures:n,conversions:x1}});
  console.log(JSON.stringify({example:name,...result},null,2));
 }
}
