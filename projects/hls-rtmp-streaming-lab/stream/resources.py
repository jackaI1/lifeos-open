"""Scoped fallback cleanup for test browsers if their npm wrapper is interrupted."""
import json
import os
import signal
import subprocess
import time


def identity(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'pgid=', '-o', 'lstart='], capture_output=True, text=True)
    if result.returncode or not result.stdout.strip():
        return None
    group, start = result.stdout.strip().split(None, 1)
    return dict(pid=int(pid), pgid=int(group), start=start.strip())


def group_alive(group):
    result = subprocess.run(['ps', '-axo', 'pgid=,stat='], check=True, capture_output=True, text=True)
    return any(int(parts[0]) == group and not parts[1].startswith('Z')
               for line in result.stdout.splitlines() if len(parts := line.split()) >= 2)


def stop_registered(registry, grace=5):
    if not registry.exists():
        return
    for line in registry.read_text().splitlines():
        owned = json.loads(line)
        current = identity(owned['pid'])
        if current is not None and current != owned:
            continue  # PID reused. Never signal the replacement.
        # With no leader and a still-existing group, these are its original descendants.
        if not group_alive(owned['pgid']):
            continue
        if owned['pgid'] != owned['pid']:
            raise RuntimeError('Owned browser does not have its own process group')
        group = owned['pgid']
        try:
            os.killpg(group, signal.SIGTERM)
        except ProcessLookupError:
            continue
        deadline = time.monotonic() + grace
        while group_alive(group) and time.monotonic() < deadline:
            time.sleep(0.05)
        if group_alive(group):
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 3
            while group_alive(group) and time.monotonic() < deadline:
                time.sleep(0.05)
        if group_alive(group):
            raise RuntimeError(f'Owned browser process group {group} still has running descendants')
        print(f"Cleaned owned browser group {group} (start {owned['start']}); no running descendants", flush=True)
