import {hash} from '../shared/hash.mjs';
import {zonedDateTime} from '../domain/time.mjs';

// The role is owner-authored evidence. Updating its source fields must not erase work already logged.
export function syncCoopTask(store,role){
 const id='coop-'+hash(role.id).slice(0,32),old=store.get('task',id),data=role.data;
 const excluded=/gambl|casino|sports.?bet|bookmak/i.test([data.industry,data.title,data.employer].join(' '));
 const inactive=data.archived||data.undone||excluded||['closed','applied','interview','offer'].includes(data.status);
 const priorStatus=old?.data.status==='archived'?'todo':old?.data.status??'todo';
 const dueAt=data.deadlineDate&&data.deadlineTime?zonedDateTime(data.deadlineDate,data.deadlineTime,{timeZone:store.get('settings','preferences')?.data.timezone??'America/Toronto'}):null;
 const task={...old?.data,title:`Prepare for ${data.title} at ${data.employer}`,category:'coop',coopRoleId:role.id,
  status:inactive?'archived':priorStatus,dueAt,dueDate:data.deadlineDate||null,deadlineTime:data.deadlineTime||null,
  instructions:data.description??'',sourceUrl:data.sourceUrl||null,source:{url:data.sourceUrl||null,type:'owner-recorded-role',roleId:role.id,roleVersion:role.version,deadlineEvidence:data.deadlineEvidence||null},
  deadlineConfidence:data.deadlineDate&&data.deadlineTime?'owner-recorded':'unknown-time',
  nextStep:excluded?'This industry is excluded by your preferences.':'Open the original posting and check its requirements against your saved resume.',nextStepMinutes:10,
  estimateConfidence:old?.data.estimateConfidence??'unknown',policy:{status:'owner-authorized',administration:true},marked:false,
  exclusionReason:excluded?'Excluded industry':null,roleStatusEvidence:'self-reported',createdAt:old?.data.createdAt??role.createdAt};
 return store.put('task',id,task,old?.version??0,{actor:'owner-role-synchronization'});
}
