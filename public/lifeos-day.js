const formatters=new Map();
function formatterFor(timeZone){let formatter=formatters.get(timeZone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});formatters.set(timeZone,formatter);}return formatter;}
export function lifeosDay(value=Date.now(),timeZone='America/Toronto'){
 const date=new Date(value);if(!Number.isFinite(date.valueOf()))throw new RangeError('Invalid timestamp');
 const p=Object.fromEntries(formatterFor(timeZone).formatToParts(date).map(x=>[x.type,x.value]));const civil=`${p.year}-${p.month}-${p.day}`;
 if(Number(p.hour)>=5)return civil;const prior=new Date(civil+'T12:00:00Z');prior.setUTCDate(prior.getUTCDate()-1);return prior.toISOString().slice(0,10);
}

export function nextLifeosDayAt(value=Date.now(),timeZone='America/Toronto'){const now=new Date(value).getTime(),day=lifeosDay(now,timeZone);let low=now,high=now+27*3600000;while(high-low>1){const mid=Math.floor((low+high)/2);if(lifeosDay(mid,timeZone)===day)low=mid;else high=mid;}return high;}
