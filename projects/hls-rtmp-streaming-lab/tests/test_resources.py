import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from stream.resources import identity, stop_registered


class ResourceTests(unittest.TestCase):
    def test_stops_only_registered_process_with_matching_start_time(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], start_new_session=True)
        try:
            with tempfile.TemporaryDirectory() as directory:
                registry = Path(directory) / 'browser.jsonl'
                info = identity(child.pid)
                registry.write_text(json.dumps(dict(info, start='stale identity')) + '\n')
                stop_registered(registry)
                self.assertIsNone(child.poll())
                registry.write_text(json.dumps(info) + '\n')
                stop_registered(registry)
                child.wait(timeout=5)
                self.assertIsNotNone(child.returncode)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)

    def test_cleans_descendant_when_browser_leader_exits_first(self):
        from stream.resources import group_alive
        code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-u','-c',\"import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready', flush=True); time.sleep(60)\"]); time.sleep(60)"
        child = subprocess.Popen([sys.executable, '-u', '-c', code], start_new_session=True, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            with tempfile.TemporaryDirectory() as directory:
                registry = Path(directory) / 'browser.jsonl'
                registry.write_text(json.dumps(identity(child.pid)) + '\n')
                stop_registered(registry, grace=0.2)
                child.wait(timeout=5)
                self.assertFalse(group_alive(child.pid))
        finally:
            import os, signal
            if group_alive(child.pid): os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
            child.stdout.close()
