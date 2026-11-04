// src/analytics/banner.ts
var DOCS_URL = "https://github.com/jackaI1/lifeos-open/blob/main/docs/analytics.md";
function mountConsentBanner(doc, analytics) {
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
  return { destroy: () => root.remove(), open: () => render(true) };
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
    if (loaded) return;
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
    const response = await fetchImpl(input, init);
    try {
      if (response.ok && analytics.consent() === "granted") {
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
function startAnalytics(win, storage) {
  const config = configFromDocument(win.document);
  if (!config) return null;
  const w = win;
  const dataLayer = w.dataLayer ||= [];
  const nav = win.navigator;
  const analytics = createAnalytics({
    config,
    dataLayer,
    storage,
    origin: win.location.origin,
    setDisabled: (disabled) => {
      if (config.ga4Id) win[`ga-disable-${config.ga4Id}`] = disabled;
    },
    privacySignal: nav.globalPrivacyControl === true || nav.doNotTrack === "1",
    loadScript: (src) => {
      const script = win.document.createElement("script");
      script.async = true;
      script.src = src;
      win.document.head.append(script);
    }
  });
  const css = win.document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/analytics-consent.css";
  win.document.head.append(css);
  mountConsentBanner(win.document, analytics);
  observeViews({
    hash: () => win.location.hash,
    origin: () => win.location.origin,
    onHashChange: (listener) => {
      win.addEventListener("hashchange", listener);
      return () => win.removeEventListener("hashchange", listener);
    }
  }, analytics).report();
  return { analytics, wrapFetch: (fetchImpl, network) => observeFetch(analyticsTransport(fetchImpl, network, analytics, win.location.origin), analytics, win.location.origin) };
}
export {
  startAnalytics
};
