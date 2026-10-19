import {createHash} from 'node:crypto';
const cents=x=>{if(typeof x!=='number'||!Number.isFinite(x))throw Error('A source amount is not numeric');return Math.round(x*100);};
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)?x:typeof x==='number'?new Date(Date.UTC(1899,11,30)+x*86400000).toISOString().slice(0,10):null;
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
export function importFinanceSheet({values,spreadsheetId,sheetId}){
 if(values?.[3]?.[0]!=='Category'||values?.[16]?.[0]!=='Date'||values?.[16]?.[5]!=='Item')throw Error('The source layout changed. Review columns before importing.');
 const columns=[{offset:0,bucket:'tithe'},{offset:4,bucket:'needs'},{offset:8,bucket:'medical'},{offset:12,bucket:'giving'},{offset:16,bucket:'wants'}],items=new Map(),occurrences=new Map();
 for(const {offset,bucket}of columns)for(let row=17;row<values.length;row++){
  const source=values[row],date=day(source[offset]),description=source[offset+1],amount=source[offset+2];if(!date&&!description&&(amount==null||amount===''))continue;if(!date||typeof description!=='string'||typeof amount!=='number')throw Error('Incomplete source transaction row '+(row+1));
  const key=date+'|'+description.trim().toLowerCase(),occurrenceKey=bucket+'|'+key,index=occurrences.get(occurrenceKey)||0;occurrences.set(occurrenceKey,index+1);const identity=key+'|'+index;let item=items.get(identity);
  if(!item){const category=bucket==='giving'||bucket==='tithe'?'giving':bucket==='medical'?'medical':/^(food|cash for food)\s*-\s*/i.test(description)?'dining':/^shopping\s*-\s*/i.test(description)?'shopping':'uncategorized';item={id:'sheet-'+hash(spreadsheetId+'|'+identity),date,description,merchantKey:description.replace(/^[^-]+ - /,'').trim().toLowerCase(),category,amountCents:0,ledger:{needs:0,wants:0,giving:0,medical:0},source:{provider:'google-sheet',spreadsheetId,sheetId,rows:[]},classification:'source',recurring:category==='giving'};items.set(identity,item);}
  const value=cents(amount);item.amountCents+=value;if(bucket!=='tithe')item.ledger[bucket]+=value;else item.titheCents=(item.titheCents||0)+value;item.source.rows.push({row:row+1,column:offset+1,bucket});
 }
 const balances={};for(const row of values.slice(4,9)){const key=({Needs:'needs',Wants:'wants',Give:'giving',Medical:'medical'})[row[0]];if(key)balances[key]=cents(row[3]);}
 const transactions=[...items.values()],balanceAsOf=transactions.reduce((a,t)=>t.date>a?t.date:a,'1900-01-01');
 const config={diningWeekly:4000,diningWantsWeekly:3000,shoppingMonthly:5000,bigQuarterly:20000,quarterAnchor:'2026-09-01',horizon:'2027-09-30',givingMonthly:[{title:'Monthly giving 1',amountCents:10180},{title:'Monthly giving 2',amountCents:9510},{title:'Monthly giving 3',amountCents:7920}],balances,balanceAsOf,reconciledThrough:balanceAsOf,source:{spreadsheetId,sheetId,title:'Finances',capturedAt:new Date().toISOString()},assumptionStatus:'unreconciled-after-source-date',excludeIncome:true,excludeRent:true};
 return {config,transactions};
}
