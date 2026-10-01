"""Verify a compiled binary outside the checkout without Node/Bun on PATH."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

repo = Path(__file__).resolve().parent.parent
binary = Path(sys.argv[1]).resolve()
baseline = json.loads((repo / "docs/effect-v4-baseline.json").read_text())
with TemporaryDirectory(prefix="framio-binary-init-") as directory:
    root = Path(directory)
    environment = {**os.environ, "PATH": "/usr/bin:/bin"}
    subprocess.run(
        [str(binary), "--version"], cwd=root, env=environment, check=True, timeout=30
    )
    subprocess.run(
        [str(binary), "init", "--skip-install"],
        cwd=root,
        env=environment,
        check=True,
        timeout=30,
    )
    count = 0
    for source, expected in baseline["scaffold"].items():
        relative = source.removeprefix("src/scaffold/")
        if relative.startswith("skill/"):
            destinations = [
                root / owner / "skills/framio" / relative[6:]
                for owner in [".claude", ".agents"]
            ]
        else:
            destinations = [
                root
                / ".framio"
                / (".gitignore" if relative == "_gitignore" else relative)
            ]
        for destination in destinations:
            actual = hashlib.sha256(destination.read_bytes()).hexdigest()
            if actual != expected:
                raise RuntimeError(f"Embedded scaffold changed: {destination}")
            count += 1
    repeat = subprocess.run(
        [str(binary), "init", "--skip-install"],
        cwd=root,
        env=environment,
        capture_output=True,
        timeout=30,
    )
    if repeat.returncode == 0:
        raise RuntimeError("Init overwrote an existing project")
    print(f"Verified {count} byte-identical destinations and overwrite protection")
