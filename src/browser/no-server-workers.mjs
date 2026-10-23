// The demo runs local mock jobs synchronously; server worker and provider sync
// entrypoints have no authority in a browser and are excluded from the bundle.
export function workerRoute(){return Response.json({error:'This workspace stays in this browser.'},{status:403});}
export async function scheduledTick(){return;}
