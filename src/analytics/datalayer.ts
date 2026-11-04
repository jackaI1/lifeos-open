import type {AnalyticsConfig} from './config.ts';
import {sanitizeEvent, type ConsentChoice, type EventMap, type EventName} from './events.ts';

export const CONSENT_KEY = 'lifeos-analytics-consent';

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface AnalyticsEnv {
  config: AnalyticsConfig;
  origin?: string;
  /** Sets the GA4 disable flag immediately when consent is withdrawn. */
  setDisabled?: (disabled: boolean) => void;
  /** The array GTM reads. Created if absent (window.dataLayer ||= []). */
  dataLayer: unknown[];
  /** Persistent consent storage; null keeps the choice for this page view only. */
  storage: StorageLike | null;
  /** Injects the GTM loader. Never called before consent is granted. */
  loadScript: (src: string) => void;
  /** navigator.globalPrivacyControl / doNotTrack. */
  privacySignal?: boolean;
  now?: () => number;
}

export type ConsentState = ConsentChoice | 'unset';

export interface Analytics {
  /** 'unset' means the visitor has not chosen yet; analytics is off in that state too. */
  consent(): ConsentState;
  /** True when a browser privacy signal (GPC / DNT) forces analytics off and no banner is needed. */
  blockedByBrowser(): boolean;
  grant(): void;
  deny(): void;
  /** Pushes to dataLayer only when consent is granted. Returns whether it was pushed. */
  track<K extends EventName>(event: K, params: EventMap[K]): boolean;
  onConsent(listener: (state: ConsentState) => void): () => void;
}

export const GTM_SRC = (id: string): string => `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;

/**
 * Consent Mode v2 with "basic" semantics: every storage type defaults to denied
 * before anything else is pushed, and the Google container script is not even
 * requested until the visitor accepts.
 */
export function createAnalytics(env: AnalyticsEnv): Analytics {
  const now = env.now ?? Date.now;
  const listeners = new Set<(state: ConsentState) => void>();
  let loaded = false;

  // `arguments` (not an array) is what GTM recognises as a gtag() command.
  function gtag(..._args: unknown[]): void { env.dataLayer.push(arguments); }

  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'granted'
  });
  gtag('set', 'ads_data_redaction', true);
  const origin = new URL(env.origin ?? 'https://lifeos.jacklai.ca').origin;
  const page = {page_location: origin + '/', page_title: 'LifeOS public demo', page_referrer: ''};
  gtag('set', {...page, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false});
  env.dataLayer.push(page);

  const blocked = env.privacySignal === true;
  const readStored = (): ConsentState => {
    try { const value = env.storage?.getItem(CONSENT_KEY); return value === 'granted' || value === 'denied' ? value : 'unset'; } catch { return 'unset'; }
  };
  const persist = (value: ConsentChoice): void => { try { env.storage?.setItem(CONSENT_KEY, value); } catch { /* choice applies to this page view only */ } };
  let state: ConsentState = blocked ? 'denied' : readStored();
  env.setDisabled?.(state !== 'granted');

  function loadContainer(): void {
    if (loaded) return;
    loaded = true;
    if (env.config.ga4Id) env.dataLayer.push({ ga4_measurement_id: env.config.ga4Id });
    env.dataLayer.push({ 'gtm.start': now(), event: 'gtm.js' });
    env.loadScript(GTM_SRC(env.config.gtmId));
  }
  function apply(next: ConsentChoice): void {
    state = next;
    env.setDisabled?.(next !== 'granted');
    gtag('consent', 'update', { analytics_storage: next });
    if (next === 'granted') loadContainer();
    for (const listener of listeners) listener(state);
  }

  const self: Analytics = {
    consent: () => state,
    blockedByBrowser: () => blocked,
    grant() {
      if (blocked || state === 'granted') return;
      persist('granted');
      apply('granted');
      self.track('consent_changed', { analytics: 'granted' });
    },
    deny() {
      if (state === 'denied') return;
      persist('denied');
      apply('denied');
    },
    track(event, params) {
      if (state !== 'granted') return false;
      const safe = sanitizeEvent(event, params, origin);
      if (!safe) return false;
      env.dataLayer.push({ event, ...safe });
      return true;
    },
    onConsent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
  if (state === 'granted') apply('granted');
  return self;
}
