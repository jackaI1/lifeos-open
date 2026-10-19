export const privateProcessingMessages=Object.freeze({
 local_processing_uncertain:'Local processing paused until its previous native request is reconciled. Source retained.',
 local_processing_deferred:'Local processing deferred. Original source retained; saved outputs are preserved when available.',
 local_recognition_failed:'Local recognition could not be validated. Original audio retained.',
 private_processing_failed:'Private processing could not finish. Original source and saved outputs retained.'
});
const deferredCodes=new Set(['local_inference_deferred','local_inference_uncertain','local_inference_aborted','lease_lost','stale_result']);
export function privateFailureReport(error){
 const code=error?.code,deferred=deferredCodes.has(code),errorCode=code==='local_inference_uncertain'?'local_processing_uncertain':deferred?'local_processing_deferred':code==='local_recognition_failed'?'local_recognition_failed':'private_processing_failed';
 return {errorCode,error:privateProcessingMessages[errorCode],...(deferred?{retryDeferred:true}:{})};
}
export function privateFailureMessage(body){return Object.hasOwn(privateProcessingMessages,body?.errorCode)?privateProcessingMessages[body.errorCode]:privateProcessingMessages.private_processing_failed;}
