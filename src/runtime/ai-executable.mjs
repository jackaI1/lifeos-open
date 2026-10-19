/** Compatible chat APIs require no local executable. */
export async function resolveAIExecutable(){return null;}
export function workerFailure(error){
 // Missing binaries, network errors and expired sign-in are not evidence of quota exhaustion.
 return {error:String(error.message).slice(0,250),quotaDeferred:error.code==='usage_limited',retryDeferred:error.code==='ai_busy',needsSignIn:error.code==='auth_required',...(['delivery_uncertain','interrupted','invalid_output'].includes(error.code)?{permanent:true}:{})};
}
