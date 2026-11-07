const { test: base, expect, chromium } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const test = base.extend({
  browser: [async ({}, use) => {
    const server = await chromium.launchServer({ headless: true });
    const child = server.process();
    let browser;
    try {
      const raw = execFileSync('ps', ['-p', String(child.pid), '-o', 'pgid=', '-o', 'lstart='], { encoding: 'utf8' }).trim();
      const [, group, started] = raw.match(/^(\d+)\s+(.+)$/);
      const owner = { pid: child.pid, pgid: Number(group), start: started.trim() };
      if (process.env.BROWSER_OWNER_FILE) require('node:fs').appendFileSync(process.env.BROWSER_OWNER_FILE, JSON.stringify(owner) + '\n');
      console.log(`Owned test Chromium ${JSON.stringify(owner)}; cleanup: BrowserServer.close()`);
      browser = await chromium.connect(server.wsEndpoint());
      await use(browser);
    } finally {
      try { if (browser) await browser.close(); }
      finally { await server.close(); }
      expect(child.exitCode !== null || child.signalCode !== null).toBeTruthy();
      console.log(`Closed owned Chromium PID ${child.pid}`);
    }
  }, { scope: 'worker' }],
});

test('plays real video at all qualities and loads readable captions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Picture quality')).toBeEnabled();
  await expect(page.getByLabel('Picture quality').locator('option')).toHaveCount(4);
  await page.locator('video').evaluate(video => video.play());
  await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(0.5);
  for (const height of [360, 480, 720]) {
    await page.getByLabel('Picture quality').selectOption({ label: `${height}p` });
    try {
      await expect.poll(() => page.locator('video').evaluate(v => v.videoHeight), { timeout: 10000 }).toBe(height);
    } catch (error) {
      console.log('Playback diagnostics', await page.evaluate(() => ({ time: video.currentTime, paused: video.paused, ended: video.ended, height: video.videoHeight, ready: video.readyState, level: hls?.currentLevel, loadLevel: hls?.loadLevel, mediaError: video.error?.message, buffered: [...Array(video.buffered.length)].map((_, i) => [video.buffered.start(i), video.buffered.end(i)]) })));
      throw error;
    }
  }
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 1; });
  await expect.poll(() => page.locator('video').evaluate(v =>
    [...v.textTracks].some(t => [...(t.cues || [])].some(cue => cue.text.includes('test broadcast')))
  )).toBeTruthy();
  await page.locator('video').evaluate(v => { v.textTracks[0].mode = 'showing'; });
  await expect.poll(() => page.locator('video').evaluate(v =>
    [...(v.textTracks[0].activeCues || [])].map(c => c.text).join(' ')
  )).toContain('test broadcast');
  await page.screenshot({ path: 'test-results/player-desktop.png' });
  await page.getByRole('button', { name: 'Load broadcast' }).click();
  await expect(page.getByLabel('Picture quality').locator('option')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('mobile layout and useful waiting state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/hls/master.m3u8', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Waiting for a broadcast');
  await expect(page.getByRole('button', { name: 'Load broadcast' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/player-mobile.png', fullPage: true });
});
