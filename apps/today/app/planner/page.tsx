import {PlannerRefresh} from "../../components/PlannerRefresh";
import {PLANNER_QUERY, demoFeedSource, runScheduleQuery, type PlannerToday} from "../../lib/schedule-graphql";

export const dynamic = "force-dynamic";
export const metadata = {title: "LifeOS planner (GraphQL)", description: "Today's schedule from the read-only GraphQL endpoint"};

// The server answers the first page through the same schema the browser uses, then the
// client can refresh it through /api/schedule-graphql.
export default async function PlannerPage() {
  const result = await runScheduleQuery({query: PLANNER_QUERY, variables: {deadlineDays: 14}}, {source: demoFeedSource()});
  const today = (result.data as {today?: PlannerToday} | null | undefined)?.today ?? null;
  return <PlannerRefresh initial={today} initialError={result.errors?.[0]?.message ?? null} />;
}
