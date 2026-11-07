export function healthLog(status,now=new Date()) {
 return {timestamp:now.toISOString(),service:'lifeos-public-demo',event:'health_check',status,ok:status>=200&&status<300};
}
