import {test as base, expect, type Browser} from '@playwright/test';

export const test = base.extend({
  browser: [async ({playwright, launchOptions}, use) => {
    const server = await playwright.chromium.launchServer(launchOptions);
    const child = server.process();
    const port = Number(new URL(server.wsEndpoint()).port);
    console.log(JSON.stringify({owner:'LifeOS study desk browser tests',pid:child.pid,start:new Date().toISOString(),port,cleanup:`kill -TERM ${child.pid}`}));
    let browser: Browser | undefined;
    try {
      browser = await playwright.chromium.connect(server.wsEndpoint());
      await use(browser);
    } finally {
      try { await browser?.close(); } finally { await server.close(); }
      if (child.exitCode === null && child.signalCode === null) throw Error('Owned test browser did not exit.');
      console.log(JSON.stringify({owner:'LifeOS study desk browser tests',pid:child.pid,exited:true}));
    }
  }, {scope:'worker'}],
});
export {expect};
