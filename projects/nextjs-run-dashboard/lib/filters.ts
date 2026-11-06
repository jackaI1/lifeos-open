export type Filters = {q:string; status:string; sort:string; page:number};
export function parseFilters(p: URLSearchParams): Filters {
 const status=p.get('status'); const sort=p.get('sort'); const page=Number(p.get('page'));
 return {q:(p.get('q')||'').trim().slice(0,100),status:status==='passed'||status==='failed'?status:'all',sort:sort==='duration'||sort==='oldest'?sort:'newest',page:Number.isSafeInteger(page)&&page>0?Math.min(page,10000):1};
}
