import type {Analytics} from './datalayer.ts';

export const DOCS_URL = 'https://github.com/jackaI1/lifeos-open/blob/main/docs/analytics.md';

/**
 * Consent banner. It is a non-modal region (the demo stays usable whatever the
 * visitor decides), both choices are explicit, and the preference can
 * be changed later from the small "Analytics" button.
 */
export function mountConsentBanner(doc: Document, analytics: Analytics, options: {localOnly?: boolean; experiments?: boolean} = {}): { destroy(): void; open(): void } {
  const root = doc.createElement('div');
  root.className = 'analytics-consent-root';
  doc.body.append(root);

  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function render(forceOpen: boolean): void {
    root.replaceChildren();
    const state = analytics.consent();
    if (analytics.blockedByBrowser()) return; // GPC / DNT: analytics stays off and nothing is shown.
    if (state === 'unset' || forceOpen) {
      const region = node('section', 'analytics-consent');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Analytics consent');
      const title = node('h2', 'analytics-consent-title', 'Help improve this demo?');
      title.id = 'analytics-consent-title';
      region.setAttribute('aria-labelledby', title.id);
      const body = node('p', 'analytics-consent-text', 'This public demo can use Google Analytics, loaded through Google Tag Manager, to count which pages and features visitors use. It never sends what you type: no titles, notes, names, amounts or dates. Nothing loads from Google unless you accept, and you can change your mind at any time. Your demo data stays in this browser either way.');
      if (options.localOnly) body.textContent = 'Allow local experiment counts? This demo compares two task button labels and counts whether I save a task after seeing one. It stores a random browser identifier and two events on this device only. Nothing is uploaded. No task titles, notes or other workspace contents are recorded. I can withdraw permission at any time; this erases the experiment log.';
      else if (options.experiments) body.textContent += ' Permission also allows an on-device task-label experiment with a random browser identifier and local exposure and save counts. Its log is erased when I withdraw.';
      const link = node('a', 'analytics-consent-link', 'See exactly what is measured');
      link.setAttribute('href', DOCS_URL);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      const actions = node('div', 'analytics-consent-actions');
      const decline = node('button', 'analytics-consent-button', 'No thanks');
      decline.type = 'button';
      decline.addEventListener('click', () => { analytics.deny(); render(false); });
      const accept = node('button', 'analytics-consent-button analytics-consent-accept', 'Allow analytics');
      accept.type = 'button';
      accept.addEventListener('click', () => { analytics.grant(); render(false); });
      actions.append(decline, accept);
      region.append(title, body, link, actions);
      root.append(region);
      return;
    }
    const reopen = node('button', 'analytics-consent-reopen', state === 'granted' ? 'Analytics: on' : 'Analytics: off');
    reopen.type = 'button';
    reopen.setAttribute('aria-label', `Analytics is ${state === 'granted' ? 'on' : 'off'}. Change analytics preference.`);
    reopen.addEventListener('click', () => render(true));
    root.append(reopen);
  }
  render(false);
  const stop = analytics.onConsent(() => render(false));
  return { destroy: () => {stop(); root.remove();}, open: () => render(true) };
}
