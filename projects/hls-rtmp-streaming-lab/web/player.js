/* A single Hls instance owns its listeners and network requests. Reload disposes it. */
const video = document.querySelector('#video');
const quality = document.querySelector('#quality');
const status = document.querySelector('#status');
const reload = document.querySelector('#reload');
let hls;
let loading = false;

async function load() {
  if (loading) return;
  loading = true;
  reload.disabled = true;
  quality.disabled = true;
  quality.replaceChildren(new Option('Automatic', '-1'));
  if (hls) { hls.destroy(); hls = undefined; }
  video.removeAttribute('src');
  video.load();
  status.textContent = 'Checking for a broadcast…';
  try {
    const response = await fetch('/hls/master.m3u8', { cache: 'no-store' });
    if (!response.ok) throw new Error('waiting');
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWebVTT: true });
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        for (const [index, level] of data.levels.entries()) {
          quality.add(new Option(`${level.height}p`, String(index)));
        }
        quality.disabled = false;
        hls.subtitleDisplay = true;
        status.textContent = 'Broadcast ready. Press play; use the caption menu for English captions.';
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        status.textContent = `Playing ${level.height}p${quality.value === '-1' ? ' with automatic quality' : ''}. Captions are in the video menu.`;
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          status.textContent = 'The broadcast could not load. Check the source, then choose Load broadcast to retry.';
          hls.destroy();
          hls = undefined;
          quality.disabled = true;
        }
      });
      hls.loadSource('/hls/master.m3u8');
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = '/hls/master.m3u8';
      status.textContent = 'Broadcast ready. This browser chooses quality automatically. Use the video menu for captions.';
    } else {
      status.textContent = 'This browser cannot play this stream. Open this page in a current Chrome, Firefox or Safari browser.';
    }
  } catch {
    status.textContent = 'Waiting for a broadcast. Start the test source below, wait six seconds, then choose Load broadcast.';
  } finally {
    loading = false;
    reload.disabled = false;
  }
}
quality.addEventListener('change', () => {
  if (hls) hls.currentLevel = Number(quality.value);
});
reload.addEventListener('click', load);
video.addEventListener('ended', () => { status.textContent = 'Broadcast finished. Press play to replay, or start a new broadcast.'; });
video.addEventListener('error', () => {
  if (video.getAttribute('src')) status.textContent = 'Playback failed. Check the source, then choose Load broadcast.';
});
window.addEventListener('pagehide', () => { if (hls) hls.destroy(); });
load();
