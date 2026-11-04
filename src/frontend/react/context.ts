/** The subset of the app shell context (public/app.js) that React views use. */
export type SubmitResult =
  | {pending: true; reason: string; auditId?: undefined}
  | {pending?: false; auditId?: string; [key: string]: unknown};

export interface ShellContext {
  /** Authenticated JSON GET against the LifeOS API. */
  request<T = unknown>(path: string): Promise<T>;
  /** Durable write queue: posts now, or keeps the change on this device while offline. */
  outbox: {submit(path: string, body: Record<string, unknown>): Promise<SubmitResult>};
  state: {routeHash: string};
  go(route: string): void;
}
