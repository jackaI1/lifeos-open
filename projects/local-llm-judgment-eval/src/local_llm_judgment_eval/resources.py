"""Bounded-lifetime RSS sampling; never starts or stops model processes."""

import os
from threading import Event, Thread

import psutil


class MemorySampler:
    """Peak sampled RSS, MiB, including an optional explicitly identified Ollama tree."""

    def __init__(self, server_pid: int | None = None):
        self.server_pid = server_pid
        self.client_peak = 0.0
        self.server_peak = None
        self.errors = []
        self.stop = Event()
        self.thread = Thread(target=self._sample, daemon=True)
        # Capture identity so PID reuse cannot accidentally measure an unrelated process.
        self.server = None
        self.server_created = None
        if server_pid:
            try:
                self.server = psutil.Process(server_pid)
                self.server_created = self.server.create_time()
            except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
                self.errors.append(type(exc).__name__ + ": server memory unmeasured")
                self.server = None

    def _once(self):
        self.client_peak = max(
            self.client_peak, psutil.Process(os.getpid()).memory_info().rss / 2**20
        )
        if self.server:
            try:
                if self.server.create_time() != self.server_created or not self.server.is_running():
                    return
                processes = [self.server, *self.server.children(recursive=True)]
                rss = 0
                for process in processes:
                    try:
                        rss += process.memory_info().rss
                    except psutil.NoSuchProcess:
                        pass
                self.server_peak = max(self.server_peak or 0, rss / 2**20)
            except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
                self.errors.append(type(exc).__name__ + ": server memory sampling stopped")
                self.server = None

    def _sample(self):
        while not self.stop.wait(0.02):
            self._once()

    def __enter__(self):
        self._once()
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.stop.set()
        self.thread.join()
        self._once()
