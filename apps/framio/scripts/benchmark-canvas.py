"""Measure local preview throughput and API latency during background captures."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from time import perf_counter, sleep
from urllib.parse import quote
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("url")
parser.add_argument("--page", required=True)
parser.add_argument("--count", type=int, default=8)
parser.add_argument("--offset", type=int, default=0)
parser.add_argument("--width", type=int, default=1441)
parser.add_argument("--scale", type=float, default=0.5)
args = parser.parse_args()
base = args.url.rstrip("/")

def request(path, payload=None):
    started = perf_counter()
    data = None if payload is None else json.dumps(payload).encode()
    with urlopen(Request(base + path, data=data, headers={"Content-Type": "application/json"}), timeout=60) as response:
        body = response.read()
        return {"milliseconds": round((perf_counter() - started) * 1000, 2),
                "status": response.status, "bytes": len(body)}, body

_, raw = request("/api/project")
snapshot = json.loads(raw)
page = next(page for page in snapshot["pages"] if page["id"] == args.page)
frames = [frame for frame in page["frames"] if frame["kind"] == "tsx"][args.offset:args.offset + args.count]
if not frames:
    parser.error("The requested page has no React frames")

def thumbnail(frame):
    return request(f'/thumb/{quote(frame["page"], safe="")}/{quote(frame["slug"], safe="")}.png?width={args.width}&scale={args.scale}')[0]

with ThreadPoolExecutor(max_workers=args.count) as pool:
    started = perf_counter()
    pending = [pool.submit(thumbnail, frame) for frame in frames]
    sleep(0.1)
    health, _ = request("/api/health")
    status, _ = request("/api/frame-status", {"id": frames[0]["id"], "version": frames[0]["version"], "error": None})
    cold = [future.result() for future in pending]
    elapsed = (perf_counter() - started) * 1000
    warm = list(pool.map(thumbnail, frames))
print(json.dumps({"page": args.page, "count": len(frames), "width": args.width,
                  "scale": args.scale, "totalMilliseconds": round(elapsed, 2),
                  "healthDuringCaptures": health, "statusDuringCaptures": status,
                  "cold": cold, "warm": warm}, indent=2))
