// Browser collector: a classic script (no imports) that exposes one global.
// It reads a few non-identifying signals and only runs after explicit consent.
// It stores nothing and sends nothing; the result is returned to the caller,
// who passes it to the scorer in score.mjs.
(function () {
  'use strict';

  function webglClass(doc) {
    try {
      const canvas = doc.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'none';
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'software';
      return 'hardware';
    } catch (error) {
      return 'unknown';
    }
  }

  function canvasRepeatable(doc) {
    try {
      const draw = () => {
        const canvas = doc.createElement('canvas');
        canvas.width = 160;
        canvas.height = 40;
        const context = canvas.getContext('2d');
        context.textBaseline = 'top';
        context.font = '14px Arial';
        context.fillText('LifeOS check', 2, 2);
        return canvas.toDataURL();
      };
      return draw() === draw();
    } catch (error) {
      return null;
    }
  }

  function gapStats(times) {
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    if (gaps.length < 2) return null;
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (mean <= 0) return null;
    const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
    return Math.sqrt(variance) / mean;
  }

  /** Resolves with the signals after sampleMs of pointer movement, or immediately without consent. */
  function collect(options) {
    if (!options || options.consent !== true) return Promise.resolve({consent: false});
    const sampleMs = Math.min(Math.max(Number(options.sampleMs) || 3000, 500), 10000);
    const doc = document;
    const nav = navigator;
    const base = {
      consent: true,
      webdriver: typeof nav.webdriver === 'boolean' ? nav.webdriver : null,
      userAgentHeadless: /HeadlessChrome/.test(nav.userAgent),
      chromium: /Chrome\//.test(nav.userAgent),
      pluginCount: nav.plugins ? nav.plugins.length : null,
      chromeObject: typeof window.chrome === 'object' && window.chrome !== null,
      languageCount: nav.languages ? nav.languages.length : null,
      outerSizeZero: window.outerWidth === 0 && window.outerHeight === 0,
      webglClass: webglClass(doc),
      canvasRepeatable: canvasRepeatable(doc),
    };
    return new Promise(resolve => {
      const times = [];
      let untrusted = 0;
      const onMove = event => {
        times.push(event.timeStamp);
        if (!event.isTrusted) untrusted++;
      };
      doc.addEventListener('pointermove', onMove, {passive: true});
      setTimeout(() => {
        doc.removeEventListener('pointermove', onMove);
        const count = times.length;
        resolve({
          ...base,
          inputEvents: count,
          untrustedRatio: count ? untrusted / count : null,
          intervalCv: gapStats(times),
        });
      }, sampleMs);
    });
  }

  globalThis.LifeOSBotSignals = Object.freeze({collect});
})();
