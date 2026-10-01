"""Compare compiled binaries with --baseline-revision identifying the baseline source."""

import argparse
import hashlib
import json
import math
import os
import pathlib
import platform
import signal
import statistics
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request


def request(url, body=None):
    encoded = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=encoded,
        headers={"Content-Type": "application/json", "Connection": "close"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def start(binary, root, env, state):
    began = time.perf_counter()
    child = subprocess.Popen(
        [binary, "__serve", str(root)],
        cwd=root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        while time.perf_counter() - began < 10:
            if child.poll() is not None:
                raise RuntimeError(f"Server exited: {child.returncode}")
            try:
                info = json.loads(state.read_text())
                if (
                    info["pid"] == child.pid
                    and request(info["url"] + "/api/health")["pid"] == child.pid
                ):
                    return child, info, (time.perf_counter() - began) * 1000
            except (OSError, ValueError):
                pass
            time.sleep(0.005)
        raise RuntimeError("Server readiness timed out")
    except BaseException:
        if child.poll() is None:
            child.terminate()
        try:
            child.wait(timeout=12)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        raise


def stop(child):
    child.send_signal(signal.SIGTERM)
    try:
        child.wait(timeout=12)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
        raise RuntimeError("Server shutdown timed out")
    if child.returncode != 0:
        raise RuntimeError(f"Server shutdown exit {child.returncode}")


def rss(pid):
    return (
        int(subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)]).strip())
        / 1024
    )


def summary(values):
    return {
        "raw": values,
        "median": statistics.median(values),
        "p95": sorted(values)[math.ceil(0.95 * len(values)) - 1],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=os.path.realpath)
    parser.add_argument("candidate", type=os.path.realpath)
    parser.add_argument(
        "--baseline-revision",
        required=True,
        help="Source revision used to build the baseline binary",
    )
    args = parser.parse_args()
    baseline, candidate = args.baseline, args.candidate
    binary_hashes = {
        label: hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()
        for label, binary in [("baseline", baseline), ("effect", candidate)]
    }
    repo = pathlib.Path(__file__).resolve().parent.parent
    samples = 13
    with tempfile.TemporaryDirectory(prefix="framio-effect-perf-") as temporary:
        root = pathlib.Path(temporary)
        frames = root / ".framio/pages/01-bench"
        frames.mkdir(parents=True)
        (root / ".framio/theme.css").write_text("body{margin:0;}")
        (frames / "one.tsx").write_text(
            'export const meta={name:"Bench",width:390,height:844};export default function Frame(){return <main style={{height:900,background:"#336699"}}>Bench</main>}'
        )
        (root / ".framio/node_modules").symlink_to(repo / "node_modules")
        (root / "home/.framio").mkdir(parents=True)
        (root / "home/.framio/browsers").symlink_to(
            pathlib.Path.home() / ".framio/browsers"
        )
        env = {**os.environ, "HOME": str(root / "home"), "PATH": "/usr/bin:/bin"}
        state = root / ".framio/.state/server.json"

        results = {
            "baseline": {"startup_ms": [], "idle_rss_mib": []},
            "effect": {"startup_ms": [], "idle_rss_mib": []},
        }
        for iteration in range(samples + 1):
            for label, binary in (
                [("baseline", baseline), ("effect", candidate)]
                if iteration % 2 == 0
                else [("effect", candidate), ("baseline", baseline)]
            ):
                child, info, elapsed = start(binary, root, env, state)
                try:
                    if iteration:
                        results[label]["startup_ms"].append(elapsed)
                        time.sleep(0.25)
                        results[label]["idle_rss_mib"].append(rss(child.pid))
                finally:
                    stop(child)
        for label, binary in [("baseline", baseline), ("effect", candidate)]:
            child, info, _ = start(binary, root, env, state)
            timings = []
            try:
                cold_started = time.perf_counter()
                request(info["url"] + "/api/screenshot", {"frames": ["01-bench/one"]})
                results[label]["cold_capture_ms"] = [
                    (time.perf_counter() - cold_started) * 1000
                ]
                for _ in range(samples):
                    began = time.perf_counter()
                    response = request(
                        info["url"] + "/api/screenshot", {"frames": ["01-bench/one"]}
                    )
                    timings.append((time.perf_counter() - began) * 1000)
                    shot = response["results"][0]
                    if shot.get("error"):
                        raise RuntimeError(shot["error"])
                    data = pathlib.Path(shot["path"]).read_bytes()
                    if struct.unpack(">II", data[16:24]) != (390, 900):
                        raise RuntimeError("Wrong capture dimensions")
                results[label]["warm_capture_ms"] = timings
                time.sleep(0.25)
                results[label]["warm_rss_mib"] = [rss(child.pid)]
                rebuilds = []
                for index in range(samples):
                    prior = request(info["url"] + "/api/project")["pages"][0]["frames"][
                        0
                    ]["version"]
                    began = time.perf_counter()
                    (frames / "one.tsx").write_text(
                        f'export const meta={{name:"Bench {index}",width:390,height:844}};export default function Frame(){{return <main style={{{{height:900,background:"#336699"}}}}>Bench {index}</main>}}'
                    )
                    while time.perf_counter() - began < 10:
                        if (
                            request(info["url"] + "/api/project")["pages"][0]["frames"][
                                0
                            ]["version"]
                            != prior
                        ):
                            break
                        time.sleep(0.005)
                    else:
                        raise RuntimeError("Rebuild timed out")
                    rebuilds.append((time.perf_counter() - began) * 1000)
                results[label]["rebuild_commit_ms"] = rebuilds
            finally:
                stop(child)
        for group in results.values():
            for key, values in list(group.items()):
                group[key] = summary(values)
        report = {
            "platform": platform.platform(),
            "binary_runtime": "Bun 1.4.2",
            "samples": samples,
            "warmup_excluded": 1,
            "fixture": "one React frame, 390x844 viewport, 900px content; no remote fonts",
            "baseline_revision": args.baseline_revision,
            "binary_sha256": binary_hashes,
            "binaries": {
                "baseline": os.path.getsize(baseline),
                "effect": os.path.getsize(candidate),
            },
            "results": results,
            "limitations": [
                "Small local sample; filesystem and Chromium cache warm",
                "RSS is server process only, excludes Chromium and canvas; sampled 250ms after readiness or warm captures",
                "Warm RSS and cold capture are single observations",
                "No browser heap or per-iframe memory distribution",
            ],
        }
        (repo / "docs/effect-v4-performance.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
        print(
            json.dumps(
                {
                    label: {
                        key: {k: v for k, v in value.items() if k != "raw"}
                        for key, value in data.items()
                    }
                    for label, data in results.items()
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
