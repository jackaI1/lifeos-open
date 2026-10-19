import {CloudStore} from './store.mjs';
export const DATABASE_BUDGET={production:{reads:1000000,writes:25000},beta:{reads:250000,writes:10000},operation:{reads:250000,writes:7000}};
export function budgetDecision(rows,operation,environment){const limit=DATABASE_BUDGET[environment]??DATABASE_BUDGET.beta,total=rows.reduce((n,r)=>({reads:n.reads+r.rows_read,writes:n.writes+r.rows_written}),{reads:0,writes:0}),own=rows.find(r=>r.operation===operation);return {allowed:total.reads<limit.reads&&total.writes<limit.writes&&!own?.blocked,reason:own?.blocked?'This operation exceeded its row budget':total.reads>=limit.reads||total.writes>=limit.writes?'Background allowance reserved for ordinary saves':null,total,limit};}
export function measuredDatabase(db,stats){
 const count=result=>{for(const r of Array.isArray(result)?result:[result]){stats.reads+=r?.meta?.rows_read??0;stats.writes+=r?.meta?.rows_written??0;}return result;};
 const wrap=statement=>({rawStatement:statement,bind(...args){return wrap(statement.bind(...args));},async all(){return count(await statement.all());},async run(){return count(await statement.run());},async first(column){const result=count(await statement.all()),row=result.results?.[0]??null;return column?row?.[column]??null:row;}});
 return {prepare:sql=>wrap(db.prepare(sql)),batch:async statements=>count(await db.batch(statements.map(s=>s.rawStatement??s)))};
}
/** Background operations only. User saves, auth and recovery never wait on this budget. */
export async function runBudgetedBackground(env,operation,work,{essential=false}={}){
 if(!/^[a-z][a-z0-9:-]{1,65}$/.test(operation))throw Error('Unknown background operation');const day=new Date().toISOString().slice(0,10),base=env.DB,store=new CloudStore(base),rows=(await store.sql('SELECT * FROM d1_operation_usage WHERE day=?',day).all()).results,decision=budgetDecision(rows,operation,env.ENVIRONMENT);
 if(!essential&&!decision.allowed)return {budgetPaused:true,reason:decision.reason,resetAt:Date.parse(day+'T00:00:00Z')+86400000};
 const stats={reads:0,writes:0};let outcome;
 try{outcome=await work(new CloudStore(measuredDatabase(base,stats)));return outcome;}
 finally{
  const previous=rows.find(r=>r.operation===operation),blocked=stats.reads+(previous?.rows_read??0)>=DATABASE_BUDGET.operation.reads||stats.writes+(previous?.rows_written??0)>=DATABASE_BUDGET.operation.writes;
  // One receipt per bounded operation, never one telemetry write per SQL query.
  try{await store.sql('INSERT INTO d1_operation_usage(day,operation,rows_read,rows_written,calls,blocked,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(day,operation) DO UPDATE SET rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written,calls=calls+1,blocked=MAX(blocked,excluded.blocked,rows_read+excluded.rows_read>=?,rows_written+excluded.rows_written>=?),updated_at=excluded.updated_at',day,operation,stats.reads,stats.writes+2,blocked?1:0,new Date().toISOString(),DATABASE_BUDGET.operation.reads,DATABASE_BUDGET.operation.writes).run();}catch{console.error(JSON.stringify({event:'database-budget-receipt-failed',operation}));}
 }
}
export async function databaseBudgetStatus(store,environment){const day=new Date().toISOString().slice(0,10),items=(await store.sql('SELECT * FROM d1_operation_usage WHERE day=? ORDER BY rows_written DESC',day).all()).results;return {day,items,...budgetDecision(items,'status',environment),coverage:'Scheduled LifeOS batches and background result processing since this release. Foreground use, external tools, earlier usage and other databases are not included.',resetAt:Date.parse(day+'T00:00:00Z')+86400000};}
