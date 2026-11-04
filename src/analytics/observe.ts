import type {Analytics} from './datalayer.ts';
import {sanitizeFeature, sanitizeItemType, sanitizeView, viewLocation, viewTitle, type EventMap, type EventName, type View} from './events.ts';

export interface TrackedEvent<K extends EventName = EventName> { event: K; params: EventMap[K] }

/**
 * Maps one successful LifeOS API call to at most one analytics event. Only the
 * HTTP method and path are inspected, plus the numeric `version` of a record
 * write (0 means "new"). Request bodies are never read for anything else.
 */
export function classifyRequest(method: string, pathname: string, version?: number): TrackedEvent | null {
  const verb = method.toUpperCase();
  if (verb === 'PUT') {
    const match = /^\/api\/records\/([^/]+)\/[^/]+$/.exec(pathname);
    const itemType = match ? sanitizeItemType(decodeURIComponent(match[1])) : null;
    if (!itemType) return null;
    return version === 0 ? { event: 'item_created', params: { item_type: itemType } } : { event: 'item_updated', params: { item_type: itemType } };
  }
  if (verb !== 'POST') return null;
  if (pathname === '/api/finances/transaction') return { event: 'budget_entry_added', params: {} };
  const action = /^\/api\/actions\/([^/]+)$/.exec(pathname);
  const feature = action ? sanitizeFeature(decodeURIComponent(action[1])) : null;
  return feature ? { event: 'feature_used', params: { feature } } : null;
}

const readVersion = (body: unknown): number | undefined => {
  if (typeof body !== 'string') return undefined;
  try { const version: unknown = (JSON.parse(body) as { version?: unknown }).version; return typeof version === 'number' ? version : undefined; } catch { return undefined; }
};

type FetchLike = (input: any, init?: any) => Promise<{ ok: boolean }>;

/** Wraps fetch. The original response is returned untouched; analytics failures never reach the app. */
export function observeFetch<F extends FetchLike>(fetchImpl: F, analytics: Analytics, origin: string): F {
  const wrapped = (async (input: any, init?: any) => {
    // A write started without permission must not become reportable just because
    // the visitor accepts while its response is still pending.
    let consentedAtStart = false;
    try { consentedAtStart = analytics.consent() === 'granted'; } catch { /* optional observer */ }
    const response = await fetchImpl(input, init);
    try {
      if (response.ok && consentedAtStart && analytics.consent() === 'granted') {
        const request = typeof input === 'object' && input !== null && 'url' in input ? input as { url: string; method?: string } : null;
        const url = new URL(request ? request.url : String(input instanceof URL ? input.href : input), origin);
        const method = init?.method ?? request?.method ?? 'GET';
        if (url.origin === new URL(origin).origin && method !== 'GET') {
          const hit = classifyRequest(method, url.pathname, readVersion(init?.body));
          if (hit) analytics.track(hit.event, hit.params as never);
        }
      }
    } catch { /* analytics must never break the app */ }
    return response;
  }) as F;
  return wrapped;
}

export interface RouteSource {
  hash(): string;
  origin(): string;
  onHashChange(listener: () => void): () => void;
}

/** Reports hash-route changes as `view_changed`. Query strings and ids in the hash are discarded. */
export function observeViews(source: RouteSource, analytics: Analytics): { current(): View | null; report(): void; stop(): void } {
  let current: View | null = null;
  const report = (): void => {
    const raw = source.hash().replace(/^#\/?/, '').split(/[?/]/)[0] || 'today';
    const view = sanitizeView(raw === 'meals' ? 'reminders' : raw);
    if (view === current) return;
    const previous = current;
    current = view;
    analytics.track('view_changed', { view, previous_view: previous ?? 'none', page_location: viewLocation(source.origin(), view), page_title: viewTitle(view) });
  };
  const stop = source.onHashChange(report);
  // A visitor who just accepted the banner has not emitted a view yet: report the one on screen.
  const unsubscribe = analytics.onConsent(state => { if (state === 'granted') { current = null; report(); } });
  return { current: () => current, report, stop: () => { stop(); unsubscribe(); } };
}

/** Only consented GA4 collection may bypass the demo's otherwise local-only fetch. */
export function analyticsTransport<F extends FetchLike>(local: F, network: F, analytics: Analytics, origin: string): F {
  return (async (input: any, init?: any) => {
    const request = typeof input === 'object' && input !== null && 'url' in input ? input as {url: string; method?: string} : null;
    const url = new URL(request ? request.url : String(input), origin);
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    const collection = url.protocol === 'https:' && !url.port && !url.username && !url.password
      && /^(?:www|region[0-9]+)\.(?:google-analytics\.com|analytics\.google\.com)$/.test(url.hostname)
      && url.pathname === '/g/collect' && ['GET', 'POST'].includes(method);
    if (collection && analytics.consent() === 'granted') return network(input, {...init, credentials: 'omit', referrerPolicy: 'no-referrer'});
    return local(input, init);
  }) as F;
}
