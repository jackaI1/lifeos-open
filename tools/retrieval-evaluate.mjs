import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localEmbedder,MODEL_ID} from '../src/local/retrieval-model.mjs';
import {RetrievalIndex,savedSources,groundedAnswer,DEFAULT_THRESHOLD} from '../src/local/retrieval.mjs';

const fixture=JSON.parse(await readFile(new URL('../test/fixtures/retrieval/questions.json',import.meta.url),'utf8'));
const scratch=await mkdtemp(join(tmpdir(),'lifeos-rag-eval-'));
let model,index;
try{
 model=await localEmbedder();
 index=new RetrievalIndex(join(scratch,'evaluation.sqlite'),{embed:model.embed,modelId:MODEL_ID});
 const indexed=await index.sync(savedSources(fixture.records)),results=[];
 for(const q of fixture.questions){
  const hits=await index.search(q.question,{k:3,threshold:DEFAULT_THRESHOLD});
  const keys=k=>new Set(hits.slice(0,k).map(h=>h.sourceKey));
  const recall=k=>q.relevant.length?q.relevant.filter(key=>keys(k).has(key)).length/q.relevant.length:null;
  const answer=await groundedAnswer(q.question,hits);
  results.push({...q,recallAt1:recall(1),recallAt3:recall(3),abstained:answer.abstained,matches:hits.map(h=>({source:h.sourceKey,score:Number(h.score.toFixed(4))}))});
 }
 const known=results.filter(q=>q.relevant.length),unknown=results.filter(q=>!q.relevant.length);
 const report={model:MODEL_ID,threshold:DEFAULT_THRESHOLD,indexed,answerable:known.length,unknown:unknown.length,
  recallAt1:known.reduce((n,q)=>n+q.recallAt1,0)/known.length,recallAt3:known.reduce((n,q)=>n+q.recallAt3,0)/known.length,
  unknownAbstention:unknown.filter(q=>q.abstained).length/unknown.length,results};
 await mkdir('.runtime/retrieval',{recursive:true});await writeFile('.runtime/retrieval/evaluation.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,results:undefined},null,2));
 // Conservative regression floors, not a claim of general-purpose answer accuracy.
 if(report.recallAt1<0.80||report.recallAt3<0.80||report.unknownAbstention<1)process.exitCode=1;
}finally{index?.close();await model?.close();await rm(scratch,{recursive:true,force:true});}
