import {mountExperiment} from './experiments/browser.ts';
import {mountConsentBanner} from './banner.ts';
import {configFromDocument} from './config.ts';
import {CONSENT_KEY, createAnalytics, type Analytics} from './datalayer.ts';
import {analyticsTransport, observeFetch, observeViews} from './observe.ts';

export type {Analytics} from './datalayer.ts';

/**
 * Browser entry for the hosted public demo. Without GTM ids it returns null unless local experiments are requested.
 * Local mode shares consent but never loads Google or transmits experiment logs.
 *
 * `storage` must be the browser's real localStorage captured BEFORE the demo
 * scopes it per workspace, so the consent choice is not part of the user's data.
 */
export function startAnalytics(win: Window & typeof globalThis, storage: Storage | null, options: {experiments?: boolean} = {}): { analytics: Analytics; wrapFetch<F extends (input: any, init?: any) => Promise<Response>>(fetchImpl: F, network: F): F } | null {
  const config = configFromDocument(win.document);
  if (!config && !options.experiments) return null;
  const w = win as Window & { dataLayer?: unknown[] };
  const dataLayer = (w.dataLayer ||= []);
  const nav = win.navigator as Navigator & { globalPrivacyControl?: boolean };
  const analytics = createAnalytics({
    config, dataLayer, storage, origin: win.location.origin,
    setDisabled: disabled => { if (config?.ga4Id) (win as unknown as Record<string, unknown>)[`ga-disable-${config.ga4Id}`] = disabled; },
    privacySignal: nav.globalPrivacyControl === true || nav.doNotTrack === '1',
    loadScript: src => { const script = win.document.createElement('script'); script.async = true; script.src = src; win.document.head.append(script); }
  });
  // A preference changed in another tab applies here immediately too.
  win.addEventListener('storage', event => {
    if (event.key !== CONSENT_KEY) return;
    if (event.newValue === 'granted') analytics.grant();
    else analytics.deny();
  });
  const css = win.document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/analytics-consent.css';
  win.document.head.append(css);
  mountConsentBanner(win.document, analytics, {localOnly: !config, experiments: options.experiments});
  // Set up before wrapping writes; observers catch later app rendering.
  let experiment: Awaited<ReturnType<typeof mountExperiment>> | null = null;
  if (options.experiments) void mountExperiment(win, analytics, storage).then(value => {experiment = value;}).catch(() => {});
  observeViews({
    hash: () => win.location.hash,
    origin: () => win.location.origin,
    onHashChange: listener => { win.addEventListener('hashchange', listener); return () => win.removeEventListener('hashchange', listener); }
  }, analytics).report();
  return { analytics, wrapFetch: (fetchImpl, network) => {
    const observed = observeFetch(analyticsTransport(fetchImpl, network, analytics, win.location.origin), analytics, win.location.origin);
    return ((input: any, init?: any) => (experiment ? experiment.wrapFetch(observed) : observed)(input, init)) as typeof fetchImpl;
  } };
}
