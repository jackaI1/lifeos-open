export const RETIRED_ACTIVATION_DATE='2099-01-02';
export function retiredProductionDevotional(config,date){return config.environment==='production'&&date===RETIRED_ACTIVATION_DATE;}

export const retiredFixtureIds=new Set(['activation-school-20260908','activation-support-20260908','activation-prayer-20260908','activation-archive-20260908','00000000-0000-4000-8000-efe3168b92e2','00000000-0000-4000-8000-d0abc6a61e09','00000000-0000-4000-8000-72fa84066c16']);
export function isRetiredProductionFixture(config,path,body){return config.environment==='production'&&(path.split('/').some(id=>retiredFixtureIds.has(id))||[body?.id,body?.threadId,body?.sessionId,body?.taskId,body?.payload?.threadId,body?.payload?.sessionId,body?.payload?.taskId].some(id=>retiredFixtureIds.has(id))||body?.synthetic===true||body?.testRunId!=null||body?.data?.synthetic===true||body?.data?.testRunId!=null);}
