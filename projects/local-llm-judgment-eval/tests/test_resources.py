import psutil

from local_llm_judgment_eval.resources import MemorySampler


def test_sampler_stops_on_failure_and_records_denied_server_without_retry(monkeypatch):
    real_process = psutil.Process
    calls = []

    class DeniedProcess:
        def create_time(self):
            calls.append("denied")
            raise psutil.AccessDenied(999999)

    def process(pid=None):
        return DeniedProcess() if pid == 999999 else real_process(pid)

    monkeypatch.setattr(psutil, "Process", process)
    try:
        with MemorySampler(999999) as memory:
            raise RuntimeError("a model call failed")
    except RuntimeError:
        pass
    assert not memory.thread.is_alive()
    assert memory.client_peak > 0
    assert memory.server_peak is None
    assert memory.errors
    assert calls == ["denied"]
