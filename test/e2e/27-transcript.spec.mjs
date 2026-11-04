import {assert, button, lecture, clickLectureTool} from './helpers.mjs';
export default async function({page: p}) {
  await lecture(p);await clickLectureTool(p, 'Transcript');
  const panel = p.getByRole('region', {name: 'Lecture transcript'});
  await panel.getByText('Authored demo transcript', {exact: true}).waitFor();
  await panel.getByText('Live transcription is available in the local edition.', {exact: false}).waitFor();
  assert.equal(await panel.getByRole('button', {name: 'Transcribe locally', exact: true}).count(), 0);
  await panel.getByRole('button', {name: /feedback loop returns/}).click();
  await p.waitForFunction(() => {const a = document.querySelector('audio.lecture-audio');return a?.readyState >= 2 && !a.paused;});
  await panel.locator('.transcript-active').waitFor();
  await button(p, 'Refresh transcript').click();
  await panel.getByText('Authored demo transcript', {exact: true}).waitFor();
  const lectures = await (await p.request.get(p.origin + '/api/lectures?course=demo-course-design')).json(), id = lectures.items[0].id;
  // Real inference is covered separately; this browser fixture isolates the media/ink seek boundary.
  await p.route('**/api/lectures/' + id, async route => {
    const response = await route.fetch(), state = await response.json();
    state.transcript = {mock: false, engine: 'faster-whisper', model: 'tiny.en', segments: [{clipId: '0000', startMs: 4500, endMs: 6000, mediaStartMs: 7500, mediaEndMs: 9885, text: 'Recognized late speech.'}]};
    await route.fulfill({response, json: state});
  });
  await button(p, 'Refresh transcript').click();
  await panel.getByText('Local Whisper · tiny.en', {exact: true}).waitFor();
  await panel.getByRole('button', {name: /Recognized late speech/}).click();
  await p.waitForFunction(() => {const a = document.querySelector('audio.lecture-audio');return a?.currentTime >= 7.5 && !a.paused;});
  await panel.locator('.transcript-active').waitFor();
}
