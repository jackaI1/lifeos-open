/**
 * Event taxonomy for the PUBLIC DEMO build only.
 *
 * Every value that can leave the browser is listed here as a closed set. Free
 * text (task titles, merchant names, notes, amounts, dates, record ids) has no
 * path into an event: the types below do not allow it and `sanitize*` helpers
 * collapse anything unexpected to a fixed bucket.
 */

/** Views that are reported by name. Anything else is reported as "other". */
export const TRACKED_VIEWS = ['today', 'school', 'tickets', 'exercise', 'reminders', 'finances', 'notes', 'photos', 'support', 'settings', 'email'] as const;
export type TrackedView = (typeof TRACKED_VIEWS)[number];
/** Devotional, prayer, journal and friends are deliberately not named. */
export type View = TrackedView | 'other';

/** Record kinds that count as "the user added something" (see docs/analytics.md). */
export const TRACKED_ITEM_TYPES = ['task', 'course', 'project', 'meal', 'grocery', 'coursework', 'run', 'coop-role'] as const;
export type ItemType = (typeof TRACKED_ITEM_TYPES)[number];

/** Server "actions" that are reported as feature usage, mapped to a stable name. */
export const FEATURE_BY_ACTION = {
  'task-progress': 'task_progress',
  'ticket-spend': 'time_logged',
  'reminder-save': 'reminder_saved',
  'schedule-entry': 'schedule_entry'
} as const;
export type Feature = (typeof FEATURE_BY_ACTION)[keyof typeof FEATURE_BY_ACTION];

export type ConsentChoice = 'granted' | 'denied';

/** dataLayer event name -> parameters. This is the whole public contract. */
export interface EventMap {
  view_changed: { view: View; previous_view: View | 'none'; page_location: string; page_title: string };
  item_created: { item_type: ItemType };
  item_updated: { item_type: ItemType };
  budget_entry_added: Record<string, never>;
  feature_used: { feature: Feature };
  consent_changed: { analytics: ConsentChoice };
}
export type EventName = keyof EventMap;
export const EVENT_NAMES: readonly EventName[] = ['view_changed', 'item_created', 'item_updated', 'budget_entry_added', 'feature_used', 'consent_changed'];

export function sanitizeView(raw: string): View {
  return (TRACKED_VIEWS as readonly string[]).includes(raw) ? (raw as TrackedView) : 'other';
}
export function sanitizeItemType(raw: string): ItemType | null {
  return (TRACKED_ITEM_TYPES as readonly string[]).includes(raw) ? (raw as ItemType) : null;
}
export function sanitizeFeature(action: string): Feature | null {
  return Object.hasOwn(FEATURE_BY_ACTION, action) ? FEATURE_BY_ACTION[action as keyof typeof FEATURE_BY_ACTION] : null;
}

const TITLES: Record<View, string> = {
  today: 'Today', school: 'Academics', tickets: 'Tickets & projects', exercise: 'Exercise', reminders: 'Reminders', finances: 'Finances',
  notes: 'Notes', photos: 'Daily photos', support: 'LifeOS Support', settings: 'Settings', email: 'Email', other: 'Other'
};
export const viewTitle = (view: View): string => TITLES[view] + ', LifeOS';
/** The location sent to GA4 is a fixed per-view path, never the real URL (no query string, no ids). */
export const viewLocation = (origin: string, view: View): string => `${origin}/#${view}`;

/** Rebuild every payload at runtime, including calls from untyped browser code. */
export function sanitizeEvent(event: string, raw: unknown, origin: string): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  switch (event) {
    case 'view_changed': {
      const view = sanitizeView(typeof value.view === 'string' ? value.view : 'other');
      const previous = value.previous_view === 'none' ? 'none' : sanitizeView(typeof value.previous_view === 'string' ? value.previous_view : 'other');
      return {view, previous_view: previous, page_location: viewLocation(origin, view), page_title: viewTitle(view)};
    }
    case 'item_created':
    case 'item_updated': {
      const kind = typeof value.item_type === 'string' ? sanitizeItemType(value.item_type) : null;
      return kind ? {item_type: kind} : null;
    }
    case 'budget_entry_added': return {};
    case 'feature_used': return Object.values(FEATURE_BY_ACTION).includes(value.feature as Feature) ? {feature: value.feature as Feature} : null;
    case 'consent_changed': return value.analytics === 'granted' || value.analytics === 'denied' ? {analytics: value.analytics} : null;
    default: return null;
  }
}
