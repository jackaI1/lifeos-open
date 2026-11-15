// Browser-side collector. It runs only after an explicit consent flag and keeps its
// readings in memory for the single check. It never writes storage or sends data.
import {summarizeInput} from './scorer.mjs';

// Markers that common automation tools leave in the page's global scope.
export const AUTOMATION_MARKERS = Object.freeze([
  '__playwright', '__pwInitScripts', '__nightmare', '_phantom', 'callPhantom',
  'domAutomation', 'domAutomationController', '__selenium_unwrapped', '__webdriver_evaluate', '__driver_evaluate',
]);
const INPUT_TYPES = ['pointermove', 'pointerdown', 'keydown'];

export function readMarkers(win, doc) {
  const globals = AUTOMATION_MARKERS.filter(name => name in win);
  const documentKeys = Object.keys(doc).filter(key => /^\$?cdc_/.test(key)).map(key => `document.${key}`);
  return [...globals, ...documentKeys];
}

export function readRenderer(doc) {
  try {
    const gl = doc.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return typeof renderer === 'string' ? renderer : null;
  } catch {
    return null;
  }
}

export function readCanvasRoundTrip(doc) {
  try {
    const ctx = doc.createElement('canvas').getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillRect(0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 0;
  } catch {
    return false;
  }
}

function observeInput(doc, win, observeMs) {
  return new Promise(resolve => {
    const events = [];
    const handler = event => events.push({type: event.type, trusted: event.isTrusted, t: win.performance.now()});
    for (const type of INPUT_TYPES) doc.addEventListener(type, handler, {passive: true});
    win.setTimeout(() => {
      for (const type of INPUT_TYPES) doc.removeEventListener(type, handler);
      resolve(summarizeInput(events));
    }, observeMs);
  });
}

/** Collect signals for one check. Without consent this returns before reading anything. */
export async function collectSignals({consent, observeMs = 3000, win = globalThis, doc = win.document, nav = win.navigator} = {}) {
  if (consent !== true) return {consented: false};
  const input = await observeInput(doc, win, observeMs);
  return {
    consented: true,
    // Browsers report false by default; a missing flag is not evidence of automation.
    webdriver: nav.webdriver === true,
    userAgent: nav.userAgent,
    plugins: nav.plugins?.length ?? null,
    languages: nav.languages?.length ?? null,
    outerWidth: win.outerWidth,
    outerHeight: win.outerHeight,
    webglRenderer: readRenderer(doc),
    canvasWorks: readCanvasRoundTrip(doc),
    automationMarkers: readMarkers(win, doc),
    input,
  };
}
