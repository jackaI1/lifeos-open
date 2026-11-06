import { test, expect, type Browser, type Page } from '@playwright/test';
async function peers(browser: Browser, action: (a: Page, b: Page) => Promise<void>) {
  const aContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const bContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  try {
    const a = await aContext.newPage(), b = await bContext.newPage();
    for (const page of [a,b]) {
      page.on('console', message => { if (message.type() === 'error') console.error(message.text().slice(0,1000)); });
      page.on('pageerror', error => console.error(error.message.slice(0,1000)));
    }
    await Promise.all([a.goto('/?room=browser-test'), b.goto('/?room=browser-test')]);
    await a.getByRole('button', {name:'Join call',exact:true}).click();
    await expect(a.getByTestId('call-state')).toHaveText('Waiting for your partner');
    await b.getByRole('button', {name:'Join call',exact:true}).click();
    for (const page of [a, b]) {
      await expect(page.getByTestId('connection-state')).toHaveText('connected');
      await expect(page.getByTestId('data-state')).toHaveText('open');
    }
    await action(a, b);
  } finally { await aContext.close(); await bContext.close(); }
}
test('two isolated browsers exchange video, stats, controls and release the call', async ({browser}) => {
  await peers(browser, async (a, b) => {
    const tracks = await a.locator('#local-video').evaluateHandle((v:HTMLVideoElement) => (v.srcObject as MediaStream).getTracks());
    for (const page of [a,b]) {
      await expect.poll(() => page.locator('#remote-video').evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
      await expect(page.getByTestId('received-bytes')).not.toHaveText('0');
    }
    await a.getByRole('button', {name:'Mute microphone',exact:true}).click();
    await expect(a.getByRole('button', {name:'Unmute microphone',exact:true})).toHaveAttribute('aria-pressed','true');
    await a.getByRole('button', {name:'Turn camera off',exact:true}).click();
    await expect(a.getByRole('button', {name:'Turn camera on',exact:true})).toBeVisible();
    await a.getByRole('button', {name:'Leave call',exact:true}).click();
    await expect(a.getByTestId('call-state')).toHaveText('Call ended');
    expect(await tracks.evaluate(items => items.every(track => track.readyState === 'ended'))).toBe(true);
    await tracks.dispose();
    await expect(b.getByTestId('call-state')).toHaveText('Your partner left. Join again to start a new call.');
    for (const page of [a,b]) {
      expect(await page.locator('#local-video').evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
      await expect(page.getByTestId('data-state')).toHaveText('closed');
    }
    // Same pages can establish a fresh call after teardown.
    await a.getByRole('button', {name:'Join call',exact:true}).click();
    await b.getByRole('button', {name:'Join call',exact:true}).click();
    await expect(a.getByTestId('connection-state')).toHaveText('connected');
    await expect(b.getByTestId('connection-state')).toHaveText('connected');
  });
});
test('real microphone audio is transcribed by the local Whisper worker and received over the data channel', async ({browser}) => {
  await peers(browser, async (a,b) => {
    // No injected transcript, mocked worker, or replacement RTCPeerConnection.
    let workerClosed = false;
    const workerReady = a.waitForEvent('worker');
    await a.getByRole('button', {name:'Enable my captions',exact:true}).click();
    const worker = await workerReady; worker.on('close', () => { workerClosed = true; });
    await Promise.race([
      expect(a.getByTestId('caption-state')).toHaveText(/Listening|Transcribing/, {timeout:120_000}),
      a.getByRole('alert').waitFor({state:'visible',timeout:120_000}).then(async () => { throw new Error(await a.getByRole('alert').textContent() ?? 'Caption failure'); }),
    ]);
    await expect(b.getByTestId('transcript')).toContainText(/hello|captions|video call/i, {timeout:120_000});
    await expect(a.getByTestId('transcript')).toContainText(/hello|captions|video call/i);
    const local = await a.locator('[data-speaker="You"]').first().textContent();
    const remote = await b.locator('[data-speaker="Partner"]').first().textContent();
    expect(remote?.replace('Partner','')).toBe(local?.replace('You',''));
    await a.getByRole('button', {name:'Disable my captions',exact:true}).click();
    await expect(a.getByTestId('caption-state')).toHaveText('Captions off');
    await expect.poll(() => workerClosed).toBe(true);
  });
});
test('camera denial gives a useful error and lets the user try again', async ({page}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/?room=denied-test');
  await page.getByRole('button', {name:'Join call',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Allow camera and microphone');
  await expect(page.getByRole('button', {name:'Join call',exact:true})).toBeEnabled();
});
test('room input is validated and the call workspace fits desktop and mobile', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.local-preview')).toBeHidden();
  await page.getByLabel('Room code').fill('bad');
  await page.getByRole('button', {name:'Join call',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('6 to 64');
  for (const [name,width,height] of [['desktop',1440,960],['mobile',390,844]] as const) {
    await page.setViewportSize({width,height});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`${name}.png`),fullPage:true});
  }
});

test('leaving while media permission is pending stops the late stream', async ({page}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => {
      (window as any).releaseMedia = async () => {
        const stream = await original(constraints);
        (window as any).lateStream = stream;
        resolve(stream);
      };
    });
  });
  await page.goto('/?room=pending-test');
  await page.getByRole('button', {name:'Join call',exact:true}).click();
  await page.getByRole('button', {name:'Leave call',exact:true}).click();
  await page.evaluate(() => (window as any).releaseMedia());
  await expect.poll(() => page.evaluate(() => (window as any).lateStream.getTracks().every((t:MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await expect(page.getByTestId('call-state')).toHaveText('Call ended');
  await expect(page.getByRole('button', {name:'Join call',exact:true})).toBeEnabled();
});

test('leaving during configuration fetch immediately releases acquired camera and microphone', async ({page}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints); (window as any).acquiredStream = stream; return stream;
    };
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/config.json', async route => {
    requested = true; await gate; await route.fulfill({json:{iceServers:[]}});
  });
  try {
    await page.goto('/?room=config-test');
    await page.getByRole('button', {name:'Join call',exact:true}).click();
    await expect.poll(() => requested).toBe(true);
    await page.getByRole('button', {name:'Leave call',exact:true}).click();
    await expect.poll(() => page.evaluate(() => (window as any).acquiredStream.getTracks().every((t:MediaStreamTrack) => t.readyState === 'ended')), {timeout:2000}).toBe(true);
  } finally { release(); }
});
