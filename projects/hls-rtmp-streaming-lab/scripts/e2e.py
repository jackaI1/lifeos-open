#!/usr/bin/env python3
"""Run real RTMP -> HLS -> HTTP -> browser checks, then remove owned resources."""
import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stream.validate import validate, ValidationError
from stream.resources import identity, stop_registered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--browser', action='store_true', help='Also run Playwright video, quality and caption checks')
    args = parser.parse_args()
    project = 'hls-e2e-' + uuid.uuid4().hex[:10]
    env = dict(os.environ, HTTP_PORT='0', RTMP_PORT='0', STREAM_SECONDS='16', COMPOSE_PROJECT_NAME=project)
    prefix = ['docker', 'compose', '-p', project]
    publisher = None
    browser_runner = None

    def run(command, **kwargs):
        return subprocess.run(command, cwd=ROOT, env=env, check=True, text=True, **kwargs)

    def compose(*command, **kwargs):
        return run(prefix + list(command), **kwargs)

    def interrupted(signum, _frame):
        raise KeyboardInterrupt(f'Received signal {signum}')

    signal.signal(signal.SIGTERM, interrupted)
    with tempfile.TemporaryDirectory(prefix=project + '-') as temporary:
        log_path = Path(temporary) / 'source.log'
        browser_registry = Path(temporary) / 'browsers.jsonl'
        try:
            if not args.skip_build:
                compose('build', 'ingest', stdout=sys.stdout)
            compose('up', '-d', '--no-build', '--wait', 'ingest', 'packager')
            metadata = compose('ps', '-a', '--format', 'json', capture_output=True).stdout
            # Compose emits JSON lines. Keep only ownership/resource metadata.
            for line in metadata.splitlines():
                item = json.loads(line)
                print(json.dumps({k: item.get(k) for k in ('ID', 'Name', 'Project', 'Service', 'Publishers')}), flush=True)
                details = run(['docker', 'inspect', '--format', '{{.State.Pid}} {{.State.StartedAt}}', item['ID']], capture_output=True)
                print(f'Owned container PID/start: {details.stdout.strip()}; cleanup: docker compose -p {project} down -v --remove-orphans', flush=True)
            port = compose('port', 'ingest', '8080', capture_output=True).stdout.strip().rsplit(':', 1)[1]
            base = f'http://127.0.0.1:{port}'
            for session in (1, 2):
                if session == 2:
                    compose('restart', 'packager')
                # Wait until the RTMP subscriber is registered before publishing.
                # Otherwise a source can send its first keyframe before FFmpeg attaches.
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    with urlopen(base + '/rtmp-stat', timeout=5) as response:
                        tree = ET.fromstring(response.read())
                    if any(s.findtext('name') == 'demo' and int(s.findtext('nclients', '0')) >= 1 for s in tree.findall('.//stream')):
                        break
                    time.sleep(0.2)
                else:
                    raise RuntimeError('Packager did not subscribe to RTMP before source startup')
                with log_path.open('w') as source_log:
                    publisher = subprocess.Popen(prefix + ['run', '--rm', '--no-deps', '-T', '--name', project + '-source', 'publisher'],
                                                 cwd=ROOT, env=env, stdout=source_log, stderr=subprocess.STDOUT)
                    print(f'Owned publisher client PID {publisher.pid}; started {time.time():.3f}; cleanup: terminate client, compose down', flush=True)
                    deadline = time.monotonic() + 75
                    live_report = None
                    while time.monotonic() < deadline:
                        if publisher.poll() is not None:
                            raise RuntimeError('Publisher stopped before live playlists became ready: ' + log_path.read_text()[-1600:])
                        try:
                            live_report = validate(base + '/hls/master.m3u8', live=True, min_duration=4)
                            break
                        except (ValidationError, ValueError, KeyError, URLError):
                            time.sleep(0.4)
                    if live_report is None:
                        raise RuntimeError('Live playlist did not become valid within 75 seconds')
                    print(f'Session {session} LIVE: {json.dumps(live_report)}', flush=True)
                    publisher.wait(timeout=75)
                    if publisher.returncode:
                        raise RuntimeError('Publisher failed: ' + log_path.read_text()[-1600:])
                    publisher = None
                deadline = time.monotonic() + 35
                last_validation_error = ''
                while time.monotonic() < deadline:
                    try:
                        report = validate(base + '/hls/master.m3u8', min_duration=15.8)
                        break
                    except (ValidationError, ValueError, KeyError) as error:
                        last_validation_error = str(error)
                        time.sleep(0.4)
                else:
                    raise RuntimeError('Final playlists did not complete: ' + last_validation_error)
                # Probe in the same Docker image on macOS and CI; no host FFmpeg required.
                compose('run', '--rm', '--no-deps', 'validator')
                print(f'Session {session} COMPLETE: {json.dumps(report)}', flush=True)
                # Correct content types prevent browsers treating captions as downloads.
                for path, expected in [('master.m3u8', 'application/vnd.apple.mpegurl'), ('720p0.ts', 'video/mp2t'), ('720p0.vtt', 'text/vtt')]:
                    with urlopen(base + '/hls/' + path, timeout=5) as response:
                        assert response.headers.get_content_type() == expected, path
                if session == 1 and args.browser:
                    browser_env = dict(env, BASE_URL=base, BROWSER_OWNER_FILE=str(browser_registry))
                    browser_runner = subprocess.Popen(['npm', 'run', 'test:browser'], cwd=ROOT, env=browser_env, start_new_session=True)
                    with browser_registry.open('a') as registry:
                        registry.write(json.dumps(identity(browser_runner.pid)) + '\n')
                    print(f'Owned browser runner group {browser_runner.pid}; cleanup: signal group, verify registered browsers', flush=True)
                    if browser_runner.wait(timeout=150):
                        raise RuntimeError('Browser checks failed')
            print('PASS: two 16-second RTMP sessions, live and replay HLS, three qualities, actual segment probes, captions and restart.', flush=True)
        except BaseException:
            subprocess.run(prefix + ['logs', '--tail', '25', 'ingest', 'packager'], cwd=ROOT, env=env)
            raise
        finally:
            cleanup_errors = []
            try:
                stop_registered(browser_registry)
                if browser_runner is not None:
                    browser_runner.wait(timeout=10)
            except Exception as error:
                cleanup_errors.append(str(error))
            try:
                if publisher is not None and publisher.poll() is None:
                    publisher.terminate()
                    try:
                        publisher.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        publisher.kill()
                        publisher.wait()
            except Exception as error:
                cleanup_errors.append(str(error))
            compose('down', '-v', '--remove-orphans', '--timeout', '10')
            remaining = run(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}'], capture_output=True).stdout.strip()
            volumes = run(['docker', 'volume', 'ls', '-q', '--filter', f'label=com.docker.compose.project={project}'], capture_output=True).stdout.strip()
            networks = run(['docker', 'network', 'ls', '-q', '--filter', f'label=com.docker.compose.project={project}'], capture_output=True).stdout.strip()
            if remaining or volumes or networks:
                raise RuntimeError(f'Owned resources remain: containers={remaining}, volumes={volumes}, networks={networks}')
            print(f'Cleanup verified: no containers, volumes or networks remain for {project}.', flush=True)
            if cleanup_errors:
                raise RuntimeError('Cleanup errors: ' + '; '.join(cleanup_errors))


if __name__ == '__main__':
    main()
