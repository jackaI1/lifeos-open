"""One event per invocation: wait for RTMP, encode, retain the finished replay."""
import os
import signal
import subprocess
import time
from pathlib import Path


def command(url, captions, output):
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y',
            '-rw_timeout', '20000000', '-i', url, '-i', captions,
            '-filter_complex_threads', '1', '-filter_complex',
            '[0:v]fps=24,split=3[a][b][c];[a]scale=1280:720[v0];[b]scale=854:480[v1];[c]scale=640:360[v2]']
    for index in range(3):
        args += ['-map', f'[v{index}]', '-map', '0:a:0']
    args += ['-map', '1:s:0', '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2',
             '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-bf', '0']
    for index, bitrate in enumerate((1800, 900, 450)):
        args += [f'-b:v:{index}', f'{bitrate}k', f'-maxrate:v:{index}', f'{bitrate}k',
                 f'-bufsize:v:{index}', f'{bitrate * 2}k']
    args += ['-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '2', '-c:s', 'webvtt',
             '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event',
             '-hls_flags', 'independent_segments+temp_file',
             # Keep MPEG-TS on the same zero-based clock as sidecar WebVTT.
             '-hls_segment_options', 'mpegts_copyts=1',
             # FFmpeg adds the shared group to every variant. Repeating sgroup without
             # a subtitle stream can crash some FFmpeg versions.
             '-var_stream_map', 'v:0,a:0,s:0,sgroup:subs,language:en,name:720p v:1,a:1,name:480p v:2,a:2,name:360p',
             '-master_pl_name', 'master.m3u8', '-master_pl_publish_rate', '1',
             str(Path(output) / '%v.m3u8')]
    return args


def main():
    output = Path('/var/www/hls')
    output.mkdir(parents=True, exist_ok=True)
    # This is a dedicated named volume. Each explicit restart begins a new event.
    for file in output.iterdir():
        if file.is_file() and file.suffix in ('.m3u8', '.ts', '.vtt', '.tmp'):
            file.unlink()
    captions = os.environ.get('CAPTIONS_FILE', '/app/captions/demo.vtt')
    if not Path(captions).is_file():
        raise SystemExit(f'Caption source does not exist: {captions}')
    state = {'stop': False, 'child': None}

    def stop(_signal, _frame):
        state['stop'] = True
        if state['child'] is not None:
            state['child'].terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    url = os.environ.get('INGEST_URL', 'rtmp://ingest:1935/live/demo')
    print('Waiting for a broadcast at live/demo', flush=True)
    while not state['stop']:
        state['child'] = subprocess.Popen(command(url, captions, str(output)))
        code = state['child'].wait()
        state['child'] = None
        if state['stop']:
            return
        if code == 0:
            print('Broadcast complete. Replay and captions remain available until the next packager restart.', flush=True)
            return
        print('No usable broadcast yet; retrying in one second.', flush=True)
        time.sleep(1)


if __name__ == '__main__':
    main()
