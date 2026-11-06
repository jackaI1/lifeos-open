import {app, output} from '@azure/functions';
import {createHandlers} from './handlers.ts';
import {connect, readFeed} from './store.ts';

let connection: ReturnType<typeof connect> | undefined;
const handlers = createHandlers(async () => {
  connection ??= connect().catch(error => {connection = undefined; throw error;});
  return readFeed(await connection);
});
const heartbeat = output.storageBlob({path: 'demo-health/latest.json', connection: 'AzureWebJobsStorage'});
app.http('today', {route: 'demo/today', methods: ['GET'], authLevel: 'anonymous', handler: handlers.today});
app.http('health', {route: 'health', methods: ['GET'], authLevel: 'anonymous', extraOutputs: [heartbeat], handler: async (request, context) => {
  const response = await handlers.health(request, context);
  if (response.status === 200) context.extraOutputs.set(heartbeat, JSON.stringify(response.jsonBody));
  return response;
}});
