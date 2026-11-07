export function healthLog(status,now=new Date(),service='lifeos-public-demo') {
 return {timestamp:now.toISOString(),service,event:'health_check',status,ok:status>=200&&status<300};
}
