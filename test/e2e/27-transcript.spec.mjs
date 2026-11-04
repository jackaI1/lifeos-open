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
}
