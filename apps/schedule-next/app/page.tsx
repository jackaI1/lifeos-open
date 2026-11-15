import {ScheduleView} from '../components/ScheduleView';
import {fetchSchedule, ScheduleError, type Schedule} from '../lib/graphql';

export const dynamic = 'force-dynamic';

// The first render happens on the server, so the page already has today's schedule when it arrives.
export default async function Page() {
  let initial: Schedule | null = null;
  let initialError: string | null = null;
  try {
    initial = await fetchSchedule({
      url: process.env.SCHEDULE_GRAPHQL_URL ?? 'http://127.0.0.1:4000/graphql',
      token: process.env.SCHEDULE_GRAPHQL_TOKEN ?? '',
    });
  } catch (error) {
    initialError = error instanceof ScheduleError ? error.message : 'The schedule could not be loaded.';
  }
  return <ScheduleView initial={initial} initialError={initialError} />;
}
