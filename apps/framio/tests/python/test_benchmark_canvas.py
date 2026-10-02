import importlib.util
from concurrent.futures import Future
from pathlib import Path
import unittest
from unittest.mock import Mock

script = Path(__file__).resolve().parents[2] / "scripts/benchmark-canvas.py"
spec = importlib.util.spec_from_file_location("benchmark_canvas", script)
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class ProbeTests(unittest.TestCase):
    def test_finished_batch_skips_probe_and_reports_outcome(self):
        future = Future()
        future.set_result(None)
        request = Mock()
        self.assertEqual(benchmark.probe(request, [future], "/api/health"),
                         {"outcome": "batch-finished-before-probe"})
        request.assert_not_called()

    def test_batch_finishing_during_probe_records_both_counts(self):
        future = Future()
        def request(path, payload):
            future.set_result(None)
            return {"milliseconds": 1, "status": 200}, b""
        result = benchmark.probe(request, [future], "/api/health")
        self.assertEqual(result["pendingAtStart"], 1)
        self.assertEqual(result["pendingAtEnd"], 0)
        self.assertEqual(result["outcome"], "thumbnail-requests-pending-at-start")
        # A subsequent status probe must not claim overlap with the finished batch.
        skipped = benchmark.probe(Mock(), [future], "/api/frame-status")
        self.assertEqual(skipped["outcome"], "batch-finished-before-probe")


if __name__ == "__main__":
    unittest.main()
