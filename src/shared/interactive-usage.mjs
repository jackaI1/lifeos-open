/** Indicator only. Admission independently refreshes every provider window before launch. */
export function interactiveUsage(telemetry,now=Date.now()){
 const unknown={color:'unknown',remaining:null,perDay:null,resetAt:null,checkedAt:telemetry?.checkedAt??null,blockedUntil:null};
 if(telemetry?.authentication!=='chatgpt'||!Number.isFinite(telemetry.checkedAt)||now-telemetry.checkedAt>120000||telemetry.checkedAt>now+5000)return unknown;
 const limits=telemetry.limits,general=limits?.rateLimitsByLimitId?.[limits.rateLimits?.limitId]??limits?.rateLimits;
 if(!general||/spark/i.test(general.limitName??''))return unknown;
 const windows=[general.primary,general.secondary].filter(Boolean);
 if(!windows.length||windows.some(w=>!Number.isFinite(w.usedPercent)||w.usedPercent<0||w.usedPercent>100||!Number.isFinite(w.resetsAt)||w.resetsAt*1000<=now))return unknown;
 const weekly=windows.find(w=>w.windowDurationMins===10080);if(!weekly)return unknown;
 const remaining=100-weekly.usedPercent,resetAt=weekly.resetsAt*1000,days=(resetAt-now)/86400000,perDay=remaining/days;
 const blockedUntil=Math.max(0,...windows.filter(w=>w.usedPercent===100).map(w=>w.resetsAt*1000))||null;
 return {color:perDay<10?'red':'green',remaining,perDay,days,resetAt,checkedAt:telemetry.checkedAt,blockedUntil};
}
