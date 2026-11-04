/**
 * Build-time configuration. IDs are public identifiers (they are visible in any
 * page that uses GA4), not secrets, but they are validated before being written
 * into HTML so a bad env var can never inject markup.
 */
export interface AnalyticsConfig { gtmId: string; ga4Id?: string }

const GTM = /^GTM-[A-Z0-9]{4,12}$/;
const GA4 = /^G-[A-Z0-9]{6,12}$/;
/** Documented placeholders (GTM-XXXXXXX, G-XXXXXXXXXX) mean "not configured yet". */
const isPlaceholder = (id: string): boolean => /^(?:GTM|G)-X+$/.test(id);

export function parseGtmId(raw: string | undefined | null): string | null {
  const id = (raw ?? '').trim();
  return GTM.test(id) && !isPlaceholder(id) ? id : null;
}
export function parseGa4Id(raw: string | undefined | null): string | null {
  const id = (raw ?? '').trim();
  return GA4.test(id) && !isPlaceholder(id) ? id : null;
}

/** Read LIFEOS_GTM_ID / LIFEOS_GA4_MEASUREMENT_ID. Returns null (analytics off) unless a real GTM id is present. */
export function configFromEnv(env: Record<string, string | undefined>): AnalyticsConfig | null {
  const gtmId = parseGtmId(env.LIFEOS_GTM_ID);
  if (!gtmId) return null;
  const ga4Id = parseGa4Id(env.LIFEOS_GA4_MEASUREMENT_ID);
  return ga4Id ? { gtmId, ga4Id } : { gtmId };
}

export const META_GTM = 'lifeos-analytics-gtm';
export const META_GA4 = 'lifeos-analytics-ga4';

/** The two <meta> tags the hosted-assets build injects into the demo shell. */
export function metaTags(config: AnalyticsConfig): string {
  return `<meta name="${META_GTM}" content="${config.gtmId}">` + (config.ga4Id ? `<meta name="${META_GA4}" content="${config.ga4Id}">` : '');
}
export const hasAnalyticsMeta = (html: string): boolean => html.includes(`<meta name="${META_GTM}" content="GTM-`);

/** Re-validates at runtime, so a tampered or hand-edited tag cannot load an arbitrary container. */
export function configFromDocument(doc: { querySelector(selector: string): { getAttribute(name: string): string | null } | null }): AnalyticsConfig | null {
  const gtmId = parseGtmId(doc.querySelector(`meta[name="${META_GTM}"]`)?.getAttribute('content'));
  if (!gtmId) return null;
  const ga4Id = parseGa4Id(doc.querySelector(`meta[name="${META_GA4}"]`)?.getAttribute('content'));
  return ga4Id ? { gtmId, ga4Id } : { gtmId };
}
