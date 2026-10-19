import {financeSummary} from './finance-model.js';
export function reconciliationCandidates(transactions,decisions=[]){
 const resolved=new Set(decisions.map(d=>d.transactionId)),groups=new Map(),result=[];
 for(const r of transactions){const t=r.data??r;if(t.archived)continue;const key=[t.date,t.amountCents,t.account??'',String(t.description??'').toLowerCase().replace(/\s+/g,' ').trim()].join('|'),others=groups.get(key)??[];others.push(r);groups.set(key,others);}
 for(const rows of groups.values())for(const r of rows){const t=r.data??r;if(resolved.has(r.id))continue;const reasons=[];if(rows.length>1)reasons.push('Possible duplicate');if(t.category==='uncategorized')reasons.push('Category needed');if(/\btransfer\b|e-transfer|interac/i.test(t.description??''))reasons.push('Transfer needs review');if(reasons.length)result.push({id:r.id,reasons,otherIds:rows.filter(x=>x.id!==r.id).map(x=>x.id)});}
 return result;
}
export function previewBudget({config,transactions,day,changes}){
 const next={...config,...changes},summary=financeSummary({config:next,transactions,day});return {...summary.forecast,reconciled:config.reconciledThrough>=day,asOf:config.reconciledThrough??config.balanceAsOf,protectedGiving:summary.balances.giving};
}
export function protectedCommitments(config,summary){return {giving:config.givingMonthly.map(r=>({...r,monthlyCents:r.amountCents})),protectedGiving:summary.balances.giving,remainingGivingCommitment:summary.forecast.months*summary.forecast.recurringMonthly,medicalReserved:summary.forecast.medicalReserved,discretionary:summary.balances.needs+summary.balances.wants-summary.forecast.medicalReserved};}
