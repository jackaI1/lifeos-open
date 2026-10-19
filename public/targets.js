const routes=new Set(['today','school','tickets','prayer','devotional','exercise','meals','reminders','support','settings','finances']);
export function targetHash(target){
 if(!target||!routes.has(target.route))return null;
 const params=new URLSearchParams();
 for(const [key,param] of [['taskId','task'],['projectId','project'],['ticketId','ticket'],['eventId','event'],['detail','detail'],['day','day'],['entryId','entry'],['sessionId','session'],['listId','list'],['reminderId','reminder']])if(target[key])params.set(param,target[key]);
 return target.route+(params.size?'?'+params.toString():'');
}
export function targetLabel(target){return target?.route==='school'?'Open task':target?.route==='tickets'?(target.projectId?'Open project':'Open ticket'):({prayer:'Begin prayer',devotional:'Open devotional',exercise:'Open exercise',reminders:'Open reminder',today:'View commitment'})[target?.route]||'Open';}
export function routeQuery(hash=location.hash){return new URLSearchParams(hash.split('?')[1]??'');}
