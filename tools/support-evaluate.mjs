import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {openSupport} from '../src/support/assistant.mjs';

const fixture=JSON.parse(await readFile(new URL('../test/fixtures/support/tickets.json',import.meta.url),'utf8'));
// Always evaluate offline routing and real embeddings; Azure has separate
// transport/tool tests and is never needed for this reproducible benchmark.
const session=await openSupport({env:{RAG_MODEL_CACHE:process.env.RAG_MODEL_CACHE}});
try{
 const results=[];
 for(const ticket of fixture.tickets){
  const result=await session.assistant.ask(ticket.text);
  results.push({...ticket,actualCategory:result.category,actualStatus:result.status,categoryCorrect:result.category===ticket.category,
   decisionCorrect:result.status===ticket.status,sourceHit:ticket.source?result.citations.some(c=>c.sourceKey===ticket.source):null,
   scores:result.citations.map(c=>({source:c.sourceKey,score:c.score}))});
 }
 const answerable=results.filter(r=>r.source),unknown=results.filter(r=>r.status==='escalated');
 const report={tickets:results.length,categoryAccuracy:results.filter(r=>r.categoryCorrect).length/results.length,
  decisionAccuracy:results.filter(r=>r.decisionCorrect).length/results.length,
  sourceHitRate:answerable.filter(r=>r.sourceHit).length/answerable.length,
  escalationRecall:unknown.filter(r=>r.actualStatus==='escalated').length/unknown.length,results};
 await mkdir('.runtime/retrieval',{recursive:true});await writeFile('.runtime/retrieval/support-evaluation.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,results:undefined},null,2));
 if(report.categoryAccuracy<1||report.sourceHitRate<0.875||report.escalationRecall<1)process.exitCode=1;
}finally{await session.close();}
