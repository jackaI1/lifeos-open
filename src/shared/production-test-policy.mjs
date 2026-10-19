export const RETIRED_ACTIVATION_DATE='2099-01-02';
export function retiredProductionDevotional(config,date){return config.environment==='production'&&date===RETIRED_ACTIVATION_DATE;}

export const retiredFixtureIds=new Set();
const retiredFixture=id=>typeof id==='string'&&(/^activation-(?:school|support|prayer|archive)-\d{8}$/.test(id)||/^00000000-0000-4000-8000-[a-f0-9]{12}$/.test(id)||retiredFixtureIds.has(id));
export function isRetiredProductionFixture(config,path,body){return config.environment==='production'&&(path.split('/').some(retiredFixture)||[body?.id,body?.threadId,body?.sessionId,body?.taskId,body?.payload?.threadId,body?.payload?.sessionId,body?.payload?.taskId].some(retiredFixture)||body?.synthetic===true||body?.testRunId!=null||body?.data?.synthetic===true||body?.data?.testRunId!=null);}
