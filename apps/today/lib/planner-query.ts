// Client-safe pieces: the query text and the shape of its answer. No Node imports here.
export const PLANNER_QUERY = `query Planner($deadlineDays: Int) {
  today(deadlineDays: $deadlineDays) {
    day
    timeZone
    events { id title start end location }
    deadlines { id title day status overdue }
    withoutDate
  }
}`;

export type PlannerEvent = {id: string; title: string; start: string; end: string; location: string | null};
export type PlannerDeadline = {id: string; title: string; day: string; status: string; overdue: boolean};
export type PlannerToday = {
  day: string;
  timeZone: string;
  events: PlannerEvent[];
  deadlines: PlannerDeadline[];
  withoutDate: number;
};
