import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connect} from 'node:net';
import {chromium} from 'playwright';

test('exported Today client loads, restarts with cached data, retries and recovers', {timeout: 60000}, async () => {
  const directory = resolve('.runtime/react-native');
  await mkdir(directory, {recursive: true});
  const root = resolve('mobile/dist'), owned = [];
  let server, browserServer, browser, context, page;
  const started = pid => execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {encoding: 'utf8'}).trim();
  try {
    server = createServer(async (req, res) => {
      try {
        const path = new URL(req.url, 'http://fixture.invalid').pathname;
        const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
        if (!file.startsWith(root + '/')) {res.writeHead(403).end(); return;}
        const body = await readFile(file);
        res.writeHead(200, {'content-type': {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json'}[extname(file)] ?? 'application/octet-stream'}).end(body);
      } catch {res.writeHead(404).end();}
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port, origin = `http://127.0.0.1:${port}`;
    owned.push({owner: 'React Native static export test', pid: process.pid, started: started(process.pid), port, cleanup: 'server.close() in finally'});
    browserServer = await chromium.launchServer({headless: true, host: '127.0.0.1'});
    const browserPid = browserServer.process().pid;
    owned.push({owner: 'React Native isolated Chromium', pid: browserPid, started: started(browserPid), port: Number(new URL(browserServer.wsEndpoint()).port), cleanup: 'browser.close() and browserServer.close() in finally'});
    await writeFile(resolve(directory, 'ownership.json'), JSON.stringify(owned, null, 2));
    browser = await chromium.connect(browserServer.wsEndpoint());
    context = await browser.newContext({viewport: {width: 390, height: 844}});
    const errors = [];
    const feed = await readFile('public/demo/today.json', 'utf8');
    let offline = false, requests = 0;
    await context.route('**/public/demo/today.json', route => {
      requests++;
      return offline ? route.abort('internetdisconnected') : route.fulfill({contentType: 'application/json', body: feed});
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByText('Workshop', {exact: true}).waitFor();
    await page.getByText('Saved for offline use.', {exact: true}).waitFor();
    await page.getByText('Check the workshop reflection deadline', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: resolve(directory, 'phone.png'), fullPage: true});
    await page.getByText('Date to confirm', {exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: resolve(directory, 'phone-deadlines.png')});
    await page.setViewportSize({width: 820, height: 1180});
    await page.getByText('Today', {exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: resolve(directory, 'tablet.png'), fullPage: true});
    await page.getByText('Date to confirm', {exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: resolve(directory, 'tablet-deadlines.png')});
    // A new page on the same origin has no in-memory React state. Only the feed
    // is unavailable; web assets are still served. Native startup is covered in Jest.
    await page.close(); page = undefined;
    offline = true;
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByText('Could not refresh. Showing the saved copy.', {exact: true}).waitFor();
    await page.getByText('Workshop', {exact: true}).waitFor();
    const before = requests;
    await page.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.getByRole('button', {name: 'Retry', exact: true}).waitFor({state: 'visible'});
    assert.ok(requests > before);
    offline = false;
    await page.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.getByText('Saved for offline use.', {exact: true}).waitFor();
    await page.evaluate(() => localStorage.clear());
    offline = true;
    await page.reload();
    await page.getByText('No saved day yet. Connect to the internet and retry.', {exact: true}).waitFor();
    offline = false;
    await page.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.getByText('Workshop', {exact: true}).waitFor();
    assert.deepEqual(errors, []);
    assert.ok(requests >= 6);
  } finally {
    try {if (page) await page.close();} finally {
      try {if (context) await context.close();} finally {
        try {if (browser) await browser.close();} finally {
          try {if (browserServer) await browserServer.close();} finally {
            if (server) await new Promise(r => server.close(r));
          }
        }
      }
    }
    const released = await Promise.all(owned.map(async resource => {
      let processAlive = false;
      try {process.kill(resource.pid, 0); processAlive = true;} catch {}
      const listening = await new Promise(resolveProbe => {
        const socket = connect({host: '127.0.0.1', port: resource.port});
        socket.once('connect', () => {socket.destroy(); resolveProbe(true);});
        socket.once('error', () => resolveProbe(false));
      });
      return {...resource, processAlive, listening, released: !listening && (resource.pid === process.pid || !processAlive)};
    }));
    await writeFile(resolve(directory, 'cleanup.json'), JSON.stringify(released, null, 2));
    assert.ok(released.every(resource => resource.released), 'Owned browser process and fixture ports must close');
  }
});
