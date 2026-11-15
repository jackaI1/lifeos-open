// Shapes the components receive. The composable builds them; components only display them.
export interface WeekEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
}
export interface WeekDeadline {
  id: string;
  title: string;
  day: string;
  status: string;
  overdue: boolean;
}
export interface WeekDay {
  date: string;
  events: WeekEvent[];
  deadlines: WeekDeadline[];
}
export interface WeekSchedule {
  start: string;
  timeZone: string;
  days: WeekDay[];
  overdue: WeekDeadline[];
  withoutDate: number;
}
export type LoadStatus = 'loading' | 'ready' | 'offline' | 'error';
