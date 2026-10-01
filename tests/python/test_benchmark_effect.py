import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import time
import hashlib
import struct
import unittest
from unittest import mock

script = pathlib.Path(__file__).resolve().parents[2] / "scripts/benchmark-effect.py"
spec = importlib.util.spec_from_file_location("benchmark_effect", script)
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BenchmarkStartupTests(unittest.TestCase):
    def test_interrupted_readiness_terminates_and_reaps_the_owned_child(self):
        for force_kill in [False, True]:
            with self.subTest(
                force_kill=force_kill
            ), tempfile.TemporaryDirectory() as temp:
                root = pathlib.Path(temp)
                binary = root / "server"
                binary.write_text("#!/bin/sh\nexec /bin/sleep 60\n")
                binary.chmod(0o755)
                children = []
                original_popen = subprocess.Popen

                def spawn(*args, **kwargs):
                    child = original_popen(*args, **kwargs)
                    children.append(child)
                    if force_kill:
                        original_wait = child.wait
                        child.terminate = mock.Mock()

                        # The fallback must kill, then reap the real process.
                        def wait(timeout=None):
                            if timeout is not None:
                                raise subprocess.TimeoutExpired(str(binary), timeout)
                            return original_wait()

                        child.wait = mock.Mock(side_effect=wait)
                    return child

                try:
                    with mock.patch.object(
                        benchmark.subprocess, "Popen", side_effect=spawn
                    ), mock.patch.object(
                        benchmark,
                        "time",
                        mock.Mock(
                            perf_counter=time.perf_counter,
                            sleep=mock.Mock(side_effect=KeyboardInterrupt),
                        ),
                    ):
                        with self.assertRaises(KeyboardInterrupt):
                            benchmark.start(
                                str(binary),
                                root,
                                os.environ.copy(),
                                root / "absent.json",
                            )
                    self.assertEqual(len(children), 1)
                    self.assertIsNotNone(children[0].returncode)
                    with self.assertRaises(ChildProcessError):
                        os.waitpid(children[0].pid, os.WNOHANG)
                finally:
                    for child in children:
                        if child.poll() is None:
                            child.kill()
                        original_popen.wait(child)

    def test_missing_baseline_revision_fails_before_starting_a_server(self):
        with mock.patch.object(
            benchmark.sys, "argv", [str(script), "baseline", "candidate"]
        ), mock.patch.object(benchmark, "start") as start, contextlib.redirect_stderr(
            io.StringIO()
        ) as error:
            with self.assertRaises(SystemExit) as exit:
                benchmark.main()
        self.assertEqual(exit.exception.code, 2)
        self.assertIn("--baseline-revision", error.getvalue())
        start.assert_not_called()

    def test_report_identifies_the_supplied_revision_and_both_measured_binaries(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = pathlib.Path(temp)
            (repo / "docs").mkdir()
            baseline = repo / "baseline"
            candidate = repo / "candidate"
            baseline.write_bytes(b"older binary")
            candidate.write_bytes(b"candidate binary")
            shot = repo / "shot.png"
            shot.write_bytes(b"\0" * 16 + struct.pack(">II", 390, 900))
            version = 0

            def request(url, body=None):
                nonlocal version
                if url.endswith("/api/project"):
                    version += 1
                    return {"pages": [{"frames": [{"version": version}]}]}
                return {"results": [{"path": str(shot)}]}

            with mock.patch.object(
                benchmark, "__file__", str(repo / "scripts/benchmark-effect.py")
            ), mock.patch.object(
                benchmark.sys,
                "argv",
                [
                    str(script),
                    str(baseline),
                    str(candidate),
                    "--baseline-revision",
                    "older-source-sha",
                ],
            ), mock.patch.object(
                benchmark,
                "start",
                return_value=(mock.Mock(pid=123), {"url": "http://fixture"}, 1),
            ), mock.patch.object(
                benchmark, "stop"
            ), mock.patch.object(
                benchmark, "rss", return_value=1
            ), mock.patch.object(
                benchmark, "request", side_effect=request
            ), mock.patch.object(
                benchmark,
                "time",
                mock.Mock(perf_counter=time.perf_counter, sleep=mock.Mock()),
            ), contextlib.redirect_stdout(
                io.StringIO()
            ):
                benchmark.main()
            report = json.loads((repo / "docs/effect-v4-performance.json").read_text())
            self.assertEqual(report["baseline_revision"], "older-source-sha")
            self.assertEqual(
                report["binary_sha256"],
                {
                    "baseline": hashlib.sha256(baseline.read_bytes()).hexdigest(),
                    "effect": hashlib.sha256(candidate.read_bytes()).hexdigest(),
                },
            )


if __name__ == "__main__":
    unittest.main()
