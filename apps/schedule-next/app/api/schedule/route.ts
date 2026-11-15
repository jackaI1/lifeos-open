import {fetchSchedule, ScheduleError} from '../../../lib/graphql';

export const dynamic = 'force-dynamic';

// Browser refresh goes through here, so the GraphQL token stays on the server.
export async function GET() {
  try {
    const data = await fetchSchedule({
      url: process.env.SCHEDULE_GRAPHQL_URL ?? 'http://127.0.0.1:4000/graphql',
      token: process.env.SCHEDULE_GRAPHQL_TOKEN ?? '',
    });
    return Response.json(data, {headers: {'cache-control': 'no-store'}});
  } catch (error) {
    const message = error instanceof ScheduleError ? error.message : 'The schedule could not be loaded.';
    return Response.json({error: message}, {status: 503, headers: {'cache-control': 'no-store'}});
  }
}
