// src/analytics/experiments/analysis.ts
var PLAN = Object.freeze({ baseline: 0.2, minimumEffect: 0.05, power: 0.8, alpha: 0.05 });
var EXPERIMENT = "academic-task-entry-v1";
var Z95 = 1.959963984540054;
var Z80 = 0.8416212335729143;
function requiredPerVariant() {
  const p0 = PLAN.baseline, p1 = p0 + PLAN.minimumEffect, mean = (p0 + p1) / 2;
  return Math.ceil(((Z95 * Math.sqrt(2 * mean * (1 - mean)) + Z80 * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) / PLAN.minimumEffect) ** 2);
}
function erfc(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const value = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? value : 2 - value;
}
function validate(c) {
  if (!c || !Number.isSafeInteger(c.exposures) || !Number.isSafeInteger(c.conversions) || c.exposures < 0 || c.conversions < 0 || c.conversions > c.exposures) throw Error("Counts must be nonnegative safe integers, with conversions <= exposures.");
}
function conversion(c) {
  validate(c);
  const n = c.exposures;
  if (!n) return { ...c, rate: null, ci95: null };
  const p = c.conversions / n, z2 = Z95 ** 2, denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = Z95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return { ...c, rate: p, ci95: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}
function analyze(input) {
  if (!input || input.experiment !== EXPERIMENT) throw Error("Unknown experiment or incompatible plan.");
  const control = conversion(input.control), treatment = conversion(input.treatment);
  const minimumPerVariant = requiredPerVariant();
  const reasons = [];
  for (const [name, c] of Object.entries({ control, treatment })) {
    if (c.exposures < minimumPerVariant) reasons.push(`${name} needs ${minimumPerVariant} exposed browsers`);
    if (c.conversions < 10 || c.exposures - c.conversions < 10) reasons.push(`${name} needs at least 10 conversions and 10 non-conversions`);
  }
  const base = { experiment: EXPERIMENT, plan: PLAN, minimumPerVariant, control, treatment };
  if (reasons.length) return { ...base, status: "not enough data", reasons, winner: null, z: null, pValue: null, difference: null, differenceCi95: null };
  const n0 = control.exposures, n1 = treatment.exposures, p0 = control.rate, p1 = treatment.rate;
  const pooled = (control.conversions + treatment.conversions) / (n0 + n1);
  const difference = p1 - p0;
  const z = difference / Math.sqrt(pooled * (1 - pooled) * (1 / n0 + 1 / n1));
  const pValue = Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
  const half = Z95 * Math.sqrt(p0 * (1 - p0) / n0 + p1 * (1 - p1) / n1);
  const differenceCi95 = [Math.max(-1, difference - half), Math.min(1, difference + half)];
  const significant = pValue < PLAN.alpha && (differenceCi95[0] > 0 || differenceCi95[1] < 0);
  return { ...base, status: significant ? "winner" : "no clear difference", reasons, winner: significant ? difference > 0 ? "treatment" : "control" : null, z, pValue, difference, differenceCi95 };
}

// src/analytics/experiments/controller.ts
var STATE_KEY = "lifeos-experiment-task-entry-v1";
var WINDOW_MS = 24 * 60 * 60 * 1e3;
async function bucket(id) {
  if (!id) throw Error("A nonempty anonymous id is required.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${EXPERIMENT}:${id}`));
  return new DataView(digest).getUint32(0, false) < 2147483648 ? "control" : "treatment";
}
async function createExperiment(env) {
  const now = env.now ?? Date.now, newId = env.newId ?? (() => crypto.randomUUID());
  let state = null, variant = "control", generation = 0;
  const allowed = () => env.enabled && env.consent.consent() === "granted";
  const persist = () => {
    try {
      if (state) env.storage?.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
    }
  };
  async function sync() {
    const turn = ++generation;
    state = null;
    variant = "control";
    if (!allowed()) {
      try {
        env.storage?.removeItem(STATE_KEY);
      } catch {
      }
      env.changed?.();
      return;
    }
    let saved = null;
    try {
      const raw = JSON.parse(env.storage?.getItem(STATE_KEY) ?? "null");
      if (raw && typeof raw.id === "string" && raw.id.length <= 100 && raw.id.length > 0 && (raw.exposure === void 0 || Number.isFinite(raw.exposure)) && (raw.outcome === void 0 || Number.isFinite(raw.outcome) && raw.exposure !== void 0 && raw.outcome >= raw.exposure && raw.outcome <= raw.exposure + WINDOW_MS)) {
        saved = { id: raw.id, ...raw.exposure !== void 0 ? { exposure: raw.exposure } : {}, ...raw.outcome !== void 0 ? { outcome: raw.outcome } : {} };
      }
    } catch {
    }
    const next = saved ?? { id: newId() };
    const assigned = await bucket(next.id);
    if (turn !== generation || !allowed()) return;
    state = next;
    variant = assigned;
    persist();
    env.changed?.();
  }
  const stop = env.consent.onConsent(() => {
    void sync().catch(() => {
    });
  });
  try {
    await sync();
  } catch (error) {
    stop();
    throw error;
  }
  return {
    refresh: sync,
    variant: () => allowed() && state ? variant : "control",
    label: () => allowed() && state && variant === "treatment" ? "Plan a task" : "New task",
    expose() {
      if (!allowed() || !state || state.exposure !== void 0) return false;
      state.exposure = now();
      persist();
      return true;
    },
    /** Capture eligibility before the save starts. A consent change in flight
     * invalidates it; successful unrelated/pre-exposure writes cannot convert. */
    beginOutcome() {
      const turn = generation, eligible = allowed() && state?.exposure !== void 0;
      return (success) => {
        if (!success || !eligible || turn !== generation || !allowed() || !state || state.exposure === void 0 || state.outcome !== void 0 || now() < state.exposure || now() > state.exposure + WINDOW_MS) return false;
        state.outcome = now();
        persist();
        return true;
      };
    },
    counts() {
      const counts = { experiment: EXPERIMENT, control: { exposures: 0, conversions: 0 }, treatment: { exposures: 0, conversions: 0 } };
      if (allowed() && state) counts[variant] = { exposures: Number(state.exposure !== void 0), conversions: Number(state.outcome !== void 0) };
      return counts;
    },
    stop() {
      ++generation;
      stop();
    }
  };
}

// src/analytics/experiments/browser.ts
async function mountExperiment(win, analytics, storage) {
  const doc = win.document;
  const enabled = doc.querySelector('meta[name="lifeos-experiment-task-entry"]')?.getAttribute("content") !== "off";
  let refresh = () => {
  };
  const experiment = await createExperiment({ consent: analytics, storage, enabled, changed: () => refresh() });
  const buttons = /* @__PURE__ */ new Set();
  const visible = (button) => {
    const rect = button.getBoundingClientRect();
    return doc.visibilityState === "visible" && !button.disabled && button.isConnected && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth && win.getComputedStyle(button).visibility === "visible";
  };
  refresh = () => {
    for (const button of buttons) {
      if (!button.isConnected) {
        intersection.unobserve(button);
        buttons.delete(button);
        continue;
      }
      if (button.textContent !== experiment.label()) button.textContent = experiment.label();
      if (visible(button)) experiment.expose();
    }
  };
  const intersection = new win.IntersectionObserver(() => refresh());
  const scan = () => {
    for (const button of doc.querySelectorAll("[data-task-entry-experiment]")) {
      if (!buttons.has(button)) {
        buttons.add(button);
        intersection.observe(button);
      }
    }
    refresh();
  };
  const mutations = new win.MutationObserver(scan);
  mutations.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "style"] });
  doc.addEventListener("visibilitychange", refresh);
  const onStorage = (event) => {
    if (event.key === "lifeos-experiment-task-entry-v1") void experiment.refresh().catch(() => {
    });
  };
  win.addEventListener("storage", onStorage);
  scan();
  const reportButton = doc.createElement("button");
  reportButton.type = "button";
  reportButton.className = "analytics-consent-reopen experiment-report-button";
  reportButton.textContent = "Task label experiment";
  const dialog = doc.createElement("dialog");
  dialog.className = "experiment-report";
  dialog.setAttribute("aria-label", "Task label experiment report");
  const title = doc.createElement("h2");
  title.textContent = "Task label experiment";
  const explanation = doc.createElement("p");
  explanation.textContent = "I compare \u201CNew task\u201D with \u201CPlan a task\u201D in Academics. Counts stay in this browser and wait for analytics consent. One browser cannot establish a winner. The planned final analysis needs 1,094 browsers per version, then one comparison after the 24-hour outcome window.";
  const report = doc.createElement("pre");
  const download = doc.createElement("button");
  download.type = "button";
  download.textContent = "Download this browser\u2019s counts";
  download.addEventListener("click", () => {
    const href = win.URL.createObjectURL(new Blob([JSON.stringify(experiment.counts(), null, 2) + "\n"], { type: "application/json" }));
    const link = doc.createElement("a");
    link.href = href;
    link.download = "lifeos-task-experiment-counts.json";
    link.click();
    win.setTimeout(() => win.URL.revokeObjectURL(href), 0);
  });
  const close = doc.createElement("button");
  close.type = "button";
  close.textContent = "Close report";
  close.addEventListener("click", () => dialog.close());
  dialog.append(title, explanation, report, download, close);
  doc.body.append(dialog);
  reportButton.addEventListener("click", () => {
    const result = analyze(experiment.counts());
    report.textContent = `${enabled ? "Enabled" : "Disabled"}; this browser: ${experiment.label()}
${result.status}
Control: ${result.control.conversions}/${result.control.exposures}
Treatment: ${result.treatment.conversions}/${result.treatment.exposures}`;
    dialog.showModal();
  });
  doc.body.append(reportButton);
  return {
    experiment,
    wrapFetch(fetchImpl) {
      return (async (input, init) => {
        const finish = experiment.beginOutcome();
        const response = await fetchImpl(input, init);
        try {
          const request = input instanceof win.Request ? input : null;
          const url = new URL(request?.url ?? String(input), win.location.origin);
          const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
          if (url.origin === win.location.origin && /^\/api\/records\/task\/[^/]+$/.test(url.pathname) && method === "PUT" && typeof init?.body === "string" && JSON.parse(init.body).version === 0 && response.ok && response.status !== 202) {
            const body = await response.clone().json();
            finish(body?.pending !== true && body?.ok !== false);
          }
        } catch {
        }
        return response;
      });
    },
    stop() {
      experiment.stop();
      mutations.disconnect();
      intersection.disconnect();
      doc.removeEventListener("visibilitychange", refresh);
      win.removeEventListener("storage", onStorage);
      reportButton.remove();
      dialog.remove();
    }
  };
}

// src/analytics/banner.ts
var DOCS_URL = "https://github.com/jackaI1/lifeos-open/blob/main/docs/analytics.md";
function mountConsentBanner(doc, analytics, options = {}) {
  const root = doc.createElement("div");
  root.className = "analytics-consent-root";
  doc.body.append(root);
  const node = (tag, className, text) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== void 0) element.textContent = text;
    return element;
  };
  function render(forceOpen) {
    root.replaceChildren();
    const state = analytics.consent();
    if (analytics.blockedByBrowser()) return;
    if (state === "unset" || forceOpen) {
      const region = node("section", "analytics-consent");
      region.setAttribute("role", "region");
      region.setAttribute("aria-label", "Analytics consent");
      const title = node("h2", "analytics-consent-title", "Help improve this demo?");
      title.id = "analytics-consent-title";
      region.setAttribute("aria-labelledby", title.id);
      const body = node("p", "analytics-consent-text", "This public demo can use Google Analytics, loaded through Google Tag Manager, to count which pages and features visitors use. It never sends what you type: no titles, notes, names, amounts or dates. Nothing loads from Google unless you accept, and you can change your mind at any time. Your demo data stays in this browser either way.");
      if (options.localOnly) body.textContent = "Allow local experiment counts? This demo compares two task button labels and counts whether I save a task after seeing one. It stores a random browser identifier and two events on this device only. Nothing is uploaded. No task titles, notes or other workspace contents are recorded. I can withdraw permission at any time; this erases the experiment log.";
      else if (options.experiments) body.textContent += " Permission also allows an on-device task-label experiment with a random browser identifier and local exposure and save counts. Its log is erased when I withdraw.";
      const link = node("a", "analytics-consent-link", "See exactly what is measured");
      link.setAttribute("href", DOCS_URL);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      const actions = node("div", "analytics-consent-actions");
      const decline = node("button", "analytics-consent-button", "No thanks");
      decline.type = "button";
      decline.addEventListener("click", () => {
        analytics.deny();
        render(false);
      });
      const accept = node("button", "analytics-consent-button analytics-consent-accept", "Allow analytics");
      accept.type = "button";
      accept.addEventListener("click", () => {
        analytics.grant();
        render(false);
      });
      actions.append(decline, accept);
      region.append(title, body, link, actions);
      root.append(region);
      return;
    }
    const reopen = node("button", "analytics-consent-reopen", state === "granted" ? "Analytics: on" : "Analytics: off");
    reopen.type = "button";
    reopen.setAttribute("aria-label", `Analytics is ${state === "granted" ? "on" : "off"}. Change analytics preference.`);
    reopen.addEventListener("click", () => render(true));
    root.append(reopen);
  }
  render(false);
  const stop = analytics.onConsent(() => render(false));
  return { destroy: () => {
    stop();
    root.remove();
  }, open: () => render(true) };
}

// src/analytics/config.ts
var GTM = /^GTM-[A-Z0-9]{4,12}$/;
var GA4 = /^G-[A-Z0-9]{6,12}$/;
var isPlaceholder = (id) => /^(?:GTM|G)-X+$/.test(id);
function parseGtmId(raw) {
  const id = (raw ?? "").trim();
  return GTM.test(id) && !isPlaceholder(id) ? id : null;
}
function parseGa4Id(raw) {
  const id = (raw ?? "").trim();
  return GA4.test(id) && !isPlaceholder(id) ? id : null;
}
var META_GTM = "lifeos-analytics-gtm";
var META_GA4 = "lifeos-analytics-ga4";
function configFromDocument(doc) {
  const gtmId = parseGtmId(doc.querySelector(`meta[name="${META_GTM}"]`)?.getAttribute("content"));
  if (!gtmId) return null;
  const ga4Id = parseGa4Id(doc.querySelector(`meta[name="${META_GA4}"]`)?.getAttribute("content"));
  return ga4Id ? { gtmId, ga4Id } : { gtmId };
}

// src/analytics/events.ts
var TRACKED_VIEWS = ["today", "school", "tickets", "exercise", "reminders", "finances", "notes", "photos", "support", "settings", "email"];
var TRACKED_ITEM_TYPES = ["task", "course", "project", "meal", "grocery", "coursework", "run", "coop-role"];
var FEATURE_BY_ACTION = {
  "task-progress": "task_progress",
  "ticket-spend": "time_logged",
  "reminder-save": "reminder_saved",
  "schedule-entry": "schedule_entry"
};
function sanitizeView(raw) {
  return TRACKED_VIEWS.includes(raw) ? raw : "other";
}
function sanitizeItemType(raw) {
  return TRACKED_ITEM_TYPES.includes(raw) ? raw : null;
}
function sanitizeFeature(action) {
  return Object.hasOwn(FEATURE_BY_ACTION, action) ? FEATURE_BY_ACTION[action] : null;
}
var TITLES = {
  today: "Today",
  school: "Academics",
  tickets: "Tickets & projects",
  exercise: "Exercise",
  reminders: "Reminders",
  finances: "Finances",
  notes: "Notes",
  photos: "Daily photos",
  support: "LifeOS Support",
  settings: "Settings",
  email: "Email",
  other: "Other"
};
var viewTitle = (view) => TITLES[view] + ", LifeOS";
var viewLocation = (origin, view) => `${origin}/#${view}`;
function sanitizeEvent(event, raw, origin) {
  if (!raw || typeof raw !== "object") return null;
  const value = raw;
  switch (event) {
    case "view_changed": {
      const view = sanitizeView(typeof value.view === "string" ? value.view : "other");
      const previous = value.previous_view === "none" ? "none" : sanitizeView(typeof value.previous_view === "string" ? value.previous_view : "other");
      return { view, previous_view: previous, page_location: viewLocation(origin, view), page_title: viewTitle(view) };
    }
    case "item_created":
    case "item_updated": {
      const kind = typeof value.item_type === "string" ? sanitizeItemType(value.item_type) : null;
      return kind ? { item_type: kind } : null;
    }
    case "budget_entry_added":
      return {};
    case "feature_used":
      return Object.values(FEATURE_BY_ACTION).includes(value.feature) ? { feature: value.feature } : null;
    case "consent_changed":
      return value.analytics === "granted" || value.analytics === "denied" ? { analytics: value.analytics } : null;
    default:
      return null;
  }
}

// src/analytics/datalayer.ts
var CONSENT_KEY = "lifeos-analytics-consent";
var GTM_SRC = (id) => `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
function createAnalytics(env) {
  const now = env.now ?? Date.now;
  const listeners = /* @__PURE__ */ new Set();
  let loaded = false;
  function gtag(..._args) {
    env.dataLayer.push(arguments);
  }
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted"
  });
  gtag("set", "ads_data_redaction", true);
  const origin = new URL(env.origin ?? "https://lifeos.jacklai.ca").origin;
  const page = { page_location: origin + "/", page_title: "LifeOS public demo", page_referrer: "" };
  gtag("set", { ...page, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  env.dataLayer.push(page);
  const blocked = env.privacySignal === true;
  const readStored = () => {
    try {
      const value = env.storage?.getItem(CONSENT_KEY);
      return value === "granted" || value === "denied" ? value : "unset";
    } catch {
      return "unset";
    }
  };
  const persist = (value) => {
    try {
      env.storage?.setItem(CONSENT_KEY, value);
    } catch {
    }
  };
  let state = blocked ? "denied" : readStored();
  env.setDisabled?.(state !== "granted");
  function loadContainer() {
    if (loaded || !env.config) return;
    loaded = true;
    if (env.config.ga4Id) env.dataLayer.push({ ga4_measurement_id: env.config.ga4Id });
    env.dataLayer.push({ "gtm.start": now(), event: "gtm.js" });
    env.loadScript(GTM_SRC(env.config.gtmId));
  }
  function apply(next) {
    state = next;
    env.setDisabled?.(next !== "granted");
    gtag("consent", "update", { analytics_storage: next });
    if (next === "granted") loadContainer();
    for (const listener of listeners) listener(state);
  }
  const self = {
    consent: () => state,
    blockedByBrowser: () => blocked,
    grant() {
      if (blocked || state === "granted") return;
      persist("granted");
      apply("granted");
      self.track("consent_changed", { analytics: "granted" });
    },
    deny() {
      if (state === "denied") return;
      persist("denied");
      apply("denied");
    },
    track(event, params) {
      if (state !== "granted") return false;
      const safe = sanitizeEvent(event, params, origin);
      if (!safe) return false;
      env.dataLayer.push({ event, ...safe });
      return true;
    },
    onConsent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
  if (state === "granted") apply("granted");
  return self;
}

// src/analytics/observe.ts
function classifyRequest(method, pathname, version) {
  const verb = method.toUpperCase();
  if (verb === "PUT") {
    const match = /^\/api\/records\/([^/]+)\/[^/]+$/.exec(pathname);
    const itemType = match ? sanitizeItemType(decodeURIComponent(match[1])) : null;
    if (!itemType) return null;
    return version === 0 ? { event: "item_created", params: { item_type: itemType } } : { event: "item_updated", params: { item_type: itemType } };
  }
  if (verb !== "POST") return null;
  if (pathname === "/api/finances/transaction") return { event: "budget_entry_added", params: {} };
  const action = /^\/api\/actions\/([^/]+)$/.exec(pathname);
  const feature = action ? sanitizeFeature(decodeURIComponent(action[1])) : null;
  return feature ? { event: "feature_used", params: { feature } } : null;
}
var readVersion = (body) => {
  if (typeof body !== "string") return void 0;
  try {
    const version = JSON.parse(body).version;
    return typeof version === "number" ? version : void 0;
  } catch {
    return void 0;
  }
};
function observeFetch(fetchImpl, analytics, origin) {
  const wrapped = (async (input, init) => {
    let consentedAtStart = false;
    try {
      consentedAtStart = analytics.consent() === "granted";
    } catch {
    }
    const response = await fetchImpl(input, init);
    try {
      if (response.ok && consentedAtStart && analytics.consent() === "granted") {
        const request = typeof input === "object" && input !== null && "url" in input ? input : null;
        const url = new URL(request ? request.url : String(input instanceof URL ? input.href : input), origin);
        const method = init?.method ?? request?.method ?? "GET";
        if (url.origin === new URL(origin).origin && method !== "GET") {
          const hit = classifyRequest(method, url.pathname, readVersion(init?.body));
          if (hit) analytics.track(hit.event, hit.params);
        }
      }
    } catch {
    }
    return response;
  });
  return wrapped;
}
function observeViews(source, analytics) {
  let current = null;
  const report = () => {
    const raw = source.hash().replace(/^#\/?/, "").split(/[?/]/)[0] || "today";
    const view = sanitizeView(raw === "meals" ? "reminders" : raw);
    if (view === current) return;
    const previous = current;
    current = view;
    analytics.track("view_changed", { view, previous_view: previous ?? "none", page_location: viewLocation(source.origin(), view), page_title: viewTitle(view) });
  };
  const stop = source.onHashChange(report);
  const unsubscribe = analytics.onConsent((state) => {
    if (state === "granted") {
      current = null;
      report();
    }
  });
  return { current: () => current, report, stop: () => {
    stop();
    unsubscribe();
  } };
}
function analyticsTransport(local, network, analytics, origin) {
  return (async (input, init) => {
    const request = typeof input === "object" && input !== null && "url" in input ? input : null;
    const url = new URL(request ? request.url : String(input), origin);
    const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
    const collection = url.protocol === "https:" && !url.port && !url.username && !url.password && /^(?:www|region[0-9]+)\.(?:google-analytics\.com|analytics\.google\.com)$/.test(url.hostname) && url.pathname === "/g/collect" && ["GET", "POST"].includes(method);
    if (collection && analytics.consent() === "granted") return network(input, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });
    return local(input, init);
  });
}

// src/analytics/index.ts
function startAnalytics(win, storage, options = {}) {
  const config = configFromDocument(win.document);
  if (!config && !options.experiments) return null;
  const w = win;
  const dataLayer = w.dataLayer ||= [];
  const nav = win.navigator;
  const analytics = createAnalytics({
    config,
    dataLayer,
    storage,
    origin: win.location.origin,
    setDisabled: (disabled) => {
      if (config?.ga4Id) win[`ga-disable-${config.ga4Id}`] = disabled;
    },
    privacySignal: nav.globalPrivacyControl === true || nav.doNotTrack === "1",
    loadScript: (src) => {
      const script = win.document.createElement("script");
      script.async = true;
      script.src = src;
      win.document.head.append(script);
    }
  });
  win.addEventListener("storage", (event) => {
    if (event.key !== CONSENT_KEY) return;
    if (event.newValue === "granted") analytics.grant();
    else analytics.deny();
  });
  const css = win.document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/analytics-consent.css";
  win.document.head.append(css);
  mountConsentBanner(win.document, analytics, { localOnly: !config, experiments: options.experiments });
  let experiment = null;
  if (options.experiments) void mountExperiment(win, analytics, storage).then((value) => {
    experiment = value;
  }).catch(() => {
  });
  observeViews({
    hash: () => win.location.hash,
    origin: () => win.location.origin,
    onHashChange: (listener) => {
      win.addEventListener("hashchange", listener);
      return () => win.removeEventListener("hashchange", listener);
    }
  }, analytics).report();
  return { analytics, wrapFetch: (fetchImpl, network) => {
    const observed = observeFetch(analyticsTransport(fetchImpl, network, analytics, win.location.origin), analytics, win.location.origin);
    return ((input, init) => (experiment ? experiment.wrapFetch(observed) : observed)(input, init));
  } };
}
export {
  startAnalytics
};
