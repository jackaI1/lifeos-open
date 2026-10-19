/** Generic compatible APIs do not expose account quota telemetry. */
export async function readAIAccount(){return {authentication:'configured-provider',checkedAt:Date.now(),limits:{},models:[]};}
