import {demoFeedSource, localDatabaseSource, runScheduleQuery, type ScheduleSource} from "../../../lib/schedule-graphql";

export const dynamic = "force-dynamic";

// LIFEOS_SCHEDULE_DB points at a local SQLite file; without it the public demo feed is used.
function sourceFromEnvironment(): ScheduleSource {
  const file = process.env.LIFEOS_SCHEDULE_DB;
  return file ? localDatabaseSource(file, {timeZone: process.env.LIFEOS_TIME_ZONE ?? "America/Toronto"}) : demoFeedSource();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({errors: [{message: "Send JSON with a query string."}]}, {status: 400});
  }
  const result = await runScheduleQuery(body, {source: sourceFromEnvironment()});
  return Response.json(result, {status: result.data ? 200 : 400});
}
