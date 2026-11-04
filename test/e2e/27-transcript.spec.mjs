import {assert, button, lecture, clickLectureTool} from './helpers.mjs';
export default async function({page: p, allowRequestAbort}) {
  const lectures = await (await p.request.get(p.origin + '/api/lectures?course=demo-course-design')).json(), id = lectures.items[0].id;
  const mediaPath = '/api/files/' + id + '-a-0000';
  // The notebook can fall back to its saved audio after a cancelled download.
  // Permit only this fixture's GET cancellation; HTTP and other failures fail.
  const allowMediaAbort = request => {if (request.method() === 'GET' && new URL(request.url()).pathname === mediaPath) allowRequestAbort(request);};
  p.on('request', allowMediaAbort);
  async function playSentence(control, seconds) {
    const previousSource = await p.locator('audio.lecture-audio').getAttribute('src');
    await control.click();
    // A previous sentence can still be playing while playClip fetches the next
    // source. Require the new blob before checking playback or leaving the page.
    await p.waitForFunction(({previousSource, seconds}) => {
      const audio = document.querySelector('audio.lecture-audio');
      return audio?.currentSrc.startsWith('blob:') && audio.getAttribute('src') !== previousSource && audio.readyState >= 2 && audio.currentTime >= seconds && !audio.paused;
    }, {previousSource, seconds});
  }
  try {
  await lecture(p);
  await clickLectureTool(p, 'Transcript');
  const panel = p.getByRole('region', {name: 'Lecture transcript'});
  await panel.getByText('Authored demo transcript', {exact: true}).waitFor();
  await panel.getByText('Live transcription is available in the local edition.', {exact: false}).waitFor();
  assert.equal(await panel.getByRole('button', {name: 'Transcribe locally', exact: true}).count(), 0);
  await playSentence(panel.getByRole('button', {name: /feedback loop returns/}), 0);
  await panel.locator('.transcript-active').waitFor();
  await button(p, 'Refresh transcript').click();
  await panel.getByText('Authored demo transcript', {exact: true}).waitFor();
  // Real inference is covered separately; this browser fixture isolates the media/ink seek boundary.
  await p.route('**/api/lectures/' + id, async route => {
    const response = await route.fetch(), state = await response.json();
    state.transcript = {mock: false, engine: 'faster-whisper', model: 'tiny.en', segments: [{clipId: '0000', startMs: 4500, endMs: 6000, mediaStartMs: 7500, mediaEndMs: 9885, text: 'Recognized late speech.'}]};
    await route.fulfill({response, json: state});
  });
  await button(p, 'Refresh transcript').click();
  await panel.getByText('Local Whisper · tiny.en', {exact: true}).waitFor();
  await playSentence(panel.getByRole('button', {name: /Recognized late speech/}), 7.5);
  await panel.locator('.transcript-active').waitFor();
  } finally {await p.locator('audio.lecture-audio').evaluate(audio => audio.pause());await p.unrouteAll({behavior: 'wait'});p.off('request', allowMediaAbort);}
}
